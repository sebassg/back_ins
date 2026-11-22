import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PasswordHasher } from '@nestjs/authentication';
import { InMemoryMailTransport, MailTransport } from '@nestjs/mail';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { RefreshTokenStoreMariaDb } from '../src/modules/auth/stores/refresh-token.store.js';

/**
 * HU07 + HU12 de punta a punta, contra la MariaDB de docker-compose
 * (npm run db:up && npm run db:install). Cada ejecución crea sus propios
 * usuarios con documentos aleatorios: no depende del estado de la base.
 */
describe('Autenticación (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let correos: InMemoryMailTransport;
  let hasher: PasswordHasher;
  const api = () => request(app.getHttpServer());

  const CLAVE = 'clave-segura-123';
  const documento = () => String(Math.floor(1e9 + Math.random() * 9e9));

  async function crearUsuario(
    rol: 'ACUDIENTE' | 'DOCENTE' | 'ADMINISTRATIVO',
    estado: 'ACTIVO' | 'PENDIENTE_ACTIVACION' = 'ACTIVO',
  ) {
    const uuid = randomUUID();
    const numeroDocumento = documento();
    const correo = `${numeroDocumento}@prueba.edu.co`;
    await db.query(
      `INSERT INTO usuario (uuid, numero_documento, nombres, apellidos, correo, rol, estado)
       VALUES (?, ?, 'Prueba', 'E2E', ?, ?, ?)`,
      [uuid, numeroDocumento, correo, rol, estado],
    );
    const hash = estado === 'ACTIVO' ? await hasher.hash(CLAVE) : null;
    await db.query(
      `INSERT INTO credencial (usuario_id, hash_contrasena)
       SELECT id, ? FROM usuario WHERE uuid = ?`,
      [hash, uuid],
    );
    return { uuid, numeroDocumento, correo };
  }

  const iniciarSesion = (numeroDocumento: string, contrasena = CLAVE) =>
    api()
      .post('/api/v1/auth/iniciar-sesion')
      .send({ numeroDocumento, contrasena });

  /** El token del último enlace enviado a `correo`. */
  async function tokenDelCorreo(correo: string): Promise<string> {
    const enviado = await vi.waitFor(() => {
      const mail = correos.find({ to: correo });
      if (!mail) throw new Error(`sin correo para ${correo}`);
      return mail;
    });
    return enviado.link(/token=/).searchParams.get('token')!;
  }

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      // Las pruebas hacen más inicios de sesión por minuto que el límite.
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<DataSource>(getDataSourceToken());
    correos = app.get(MailTransport) as InMemoryMailTransport;
    hasher = app.get(PasswordHasher);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('activación: la persona define su contraseña con el enlace y luego entra (HU07-E1)', async () => {
    const pendiente = await crearUsuario('ACUDIENTE', 'PENDIENTE_ACTIVACION');

    // Sin activar, no entra (mensaje genérico).
    await iniciarSesion(pendiente.numeroDocumento).expect(401);

    await api()
      .post('/api/v1/auth/reenviar-activacion')
      .send({ numeroDocumento: pendiente.numeroDocumento })
      .expect(202);
    const token = await tokenDelCorreo(pendiente.correo);

    await api()
      .post('/api/v1/auth/activar')
      .send({ token, contrasena: CLAVE })
      .expect(204);
    // El enlace es de un solo uso.
    await api()
      .post('/api/v1/auth/activar')
      .send({ token, contrasena: CLAVE })
      .expect(400);

    const sesion = await iniciarSesion(pendiente.numeroDocumento).expect(200);
    expect(sesion.body.usuario.rol).toBe('ACUDIENTE');
  });

  it('inicio de sesión, perfil, renovación, reuso detectado y cierre (HU12-E1)', async () => {
    const docente = await crearUsuario('DOCENTE');
    const { body: sesion } = await iniciarSesion(
      docente.numeroDocumento,
    ).expect(200);

    const { body: yo } = await api()
      .get('/api/v1/usuarios/yo')
      .set('Authorization', `Bearer ${sesion.accessToken}`)
      .expect(200);
    expect(yo).toMatchObject({ uuid: docente.uuid, rol: 'DOCENTE' });

    const { body: renovada } = await api()
      .post('/api/v1/auth/renovar')
      .send({ refreshToken: sesion.refreshToken })
      .expect(200);
    expect(renovada.refreshToken).not.toBe(sesion.refreshToken);

    // Reusar el token ya rotado revoca la sesión completa: el sucesor tampoco sirve.
    await api()
      .post('/api/v1/auth/renovar')
      .send({ refreshToken: sesion.refreshToken })
      .expect(401);
    await api()
      .post('/api/v1/auth/renovar')
      .send({ refreshToken: renovada.refreshToken })
      .expect(401);
    const [revocada] = await db.query(
      `SELECT s.motivo_revocacion FROM sesion s JOIN usuario u ON u.id = s.usuario_id
        WHERE u.uuid = ? ORDER BY s.creado_en DESC LIMIT 1`,
      [docente.uuid],
    );
    expect(revocada.motivo_revocacion).toBe('REUSO_DETECTADO');

    // Una sesión nueva se cierra con su refresh token.
    const { body: otra } = await iniciarSesion(docente.numeroDocumento).expect(
      200,
    );
    await api()
      .post('/api/v1/auth/cerrar-sesion')
      .send({ refreshToken: otra.refreshToken })
      .expect(204);
    await api()
      .post('/api/v1/auth/renovar')
      .send({ refreshToken: otra.refreshToken })
      .expect(401);
  });

  it('HU07-E2: al quinto fallo bloquea 15 minutos, con el mismo mensaje', async () => {
    const acudiente = await crearUsuario('ACUDIENTE');
    const mensajes = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { body } = await iniciarSesion(
        acudiente.numeroDocumento,
        'equivocada',
      ).expect(401);
      mensajes.add(body.message);
    }
    // Ni con la contraseña correcta entra mientras dure el bloqueo.
    const { body } = await iniciarSesion(acudiente.numeroDocumento).expect(401);
    mensajes.add(body.message);
    const { body: inexistente } = await iniciarSesion('0000000000').expect(401);
    mensajes.add(inexistente.message);
    expect([...mensajes]).toEqual(['Usuario o contraseña incorrectos']);

    const [credencial] = await db.query(
      `SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), c.bloqueado_hasta) AS segundos
         FROM credencial c JOIN usuario u ON u.id = c.usuario_id WHERE u.uuid = ?`,
      [acudiente.uuid],
    );
    expect(Number(credencial.segundos)).toBeGreaterThan(14 * 60);
    expect(Number(credencial.segundos)).toBeLessThanOrEqual(15 * 60);
  });

  it('HU07-E3: recuperación por documento; el enlace es de un solo uso y cierra las sesiones', async () => {
    const acudiente = await crearUsuario('ACUDIENTE');
    const { body: sesion } = await iniciarSesion(
      acudiente.numeroDocumento,
    ).expect(200);

    // Misma respuesta exista o no el documento.
    const { body: existe } = await api()
      .post('/api/v1/auth/recuperar-contrasena')
      .send({ numeroDocumento: acudiente.numeroDocumento })
      .expect(202);
    const { body: noExiste } = await api()
      .post('/api/v1/auth/recuperar-contrasena')
      .send({ numeroDocumento: '0000000000' })
      .expect(202);
    expect(existe).toEqual(noExiste);

    const token = await tokenDelCorreo(acudiente.correo);
    const nueva = 'otra-clave-456';
    await api()
      .post('/api/v1/auth/restablecer-contrasena')
      .send({ token, contrasena: nueva })
      .expect(204);
    await api()
      .post('/api/v1/auth/restablecer-contrasena')
      .send({ token, contrasena: nueva })
      .expect(400);

    // Quien tenía la sesión anterior queda fuera.
    await api()
      .post('/api/v1/auth/renovar')
      .send({ refreshToken: sesion.refreshToken })
      .expect(401);
    await iniciarSesion(acudiente.numeroDocumento).expect(401);
    await iniciarSesion(acudiente.numeroDocumento, nueva).expect(200);
  });

  it('HU12-E2 y HU12-E3: solo el personal administrativo desactiva, y eso cierra las sesiones', async () => {
    const admin = await crearUsuario('ADMINISTRATIVO');
    const docente = await crearUsuario('DOCENTE');
    const acudiente = await crearUsuario('ACUDIENTE');
    const { body: sesionAdmin } = await iniciarSesion(
      admin.numeroDocumento,
    ).expect(200);
    const { body: sesionDocente } = await iniciarSesion(
      docente.numeroDocumento,
    ).expect(200);
    const { body: sesionAcudiente } = await iniciarSesion(
      acudiente.numeroDocumento,
    ).expect(200);

    await api()
      .patch(`/api/v1/usuarios/${docente.uuid}/desactivar`)
      .expect(401);
    await api()
      .patch(`/api/v1/usuarios/${docente.uuid}/desactivar`)
      .set('Authorization', `Bearer ${sesionAcudiente.accessToken}`)
      .expect(403);

    await api()
      .patch(`/api/v1/usuarios/${docente.uuid}/desactivar`)
      .set('Authorization', `Bearer ${sesionAdmin.accessToken}`)
      .expect(204);

    await api()
      .post('/api/v1/auth/renovar')
      .send({ refreshToken: sesionDocente.refreshToken })
      .expect(401);
    await iniciarSesion(docente.numeroDocumento).expect(401);
    const [sesion] = await db.query(
      `SELECT s.motivo_revocacion FROM sesion s JOIN usuario u ON u.id = s.usuario_id
        WHERE u.uuid = ?`,
      [docente.uuid],
    );
    expect(sesion.motivo_revocacion).toBe('USUARIO_DESACTIVADO');
  });

  it('el store marca un refresh token usado una sola vez, aunque lleguen 8 a la vez', async () => {
    const usuario = await crearUsuario('ACUDIENTE');
    const store = app.get(RefreshTokenStoreMariaDb);
    const ahora = new Date();
    const id =
      randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    await store.saveRefreshToken({
      id,
      familyId: randomUUID(),
      userId: usuario.uuid,
      createdAt: ahora,
      expiresAt: new Date(ahora.getTime() + 60_000),
      familyExpiresAt: new Date(ahora.getTime() + 120_000),
    });

    const resultados = await Promise.all(
      Array.from({ length: 8 }, () =>
        store.markRefreshTokenUsed(id, new Date()),
      ),
    );
    expect(resultados.filter(Boolean)).toHaveLength(1);
  });

  it('las bitácoras no admiten UPDATE (RNF-04)', async () => {
    await expect(
      db.query('UPDATE auditoria SET accion = accion LIMIT 1'),
    ).rejects.toThrow(/RNF-04/);
  });
});
