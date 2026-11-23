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

/**
 * HU01 de punta a punta, contra la MariaDB de docker-compose
 * (npm run db:up && npm run db:install). Cada ejecución crea su propio grupo
 * y sus propios documentos: no depende del estado de la base.
 */
describe('Estudiantes (e2e)', () => {
  let app: INestApplication;
  let db: DataSource;
  let correos: InMemoryMailTransport;
  let hasher: PasswordHasher;
  let grupoId: number;
  let tokenAdmin: string;
  const api = () => request(app.getHttpServer());

  const CLAVE = 'clave-segura-123';
  const documento = () => String(Math.floor(1e9 + Math.random() * 9e9));

  async function crearUsuario(rol: 'ACUDIENTE' | 'DOCENTE' | 'ADMINISTRATIVO') {
    const uuid = randomUUID();
    const numeroDocumento = documento();
    await db.query(
      `INSERT INTO usuario (uuid, numero_documento, nombres, apellidos, correo, rol, estado)
       VALUES (?, ?, 'Prueba', 'E2E', ?, ?, 'ACTIVO')`,
      [uuid, numeroDocumento, `${numeroDocumento}@prueba.edu.co`, rol],
    );
    await db.query(
      `INSERT INTO credencial (usuario_id, hash_contrasena)
       SELECT id, ? FROM usuario WHERE uuid = ?`,
      [await hasher.hash(CLAVE), uuid],
    );
    const { body } = await api()
      .post('/api/v1/auth/iniciar-sesion')
      .send({ numeroDocumento, contrasena: CLAVE })
      .expect(200);
    return { uuid, numeroDocumento, accessToken: body.accessToken as string };
  }

  /** El cuerpo de HU01-E1: un menor y su acudiente titular, con datos nuevos. */
  function registro(cambios: Record<string, unknown> = {}) {
    const doc = documento();
    return {
      numeroDocumento: doc,
      nombres: 'Sofía Valentina',
      apellidos: `Restrepo${doc.slice(-4)}`,
      fechaNacimiento: '2021-04-15',
      grupoId,
      acudiente: {
        numeroDocumento: documento(),
        nombres: 'Ana María',
        apellidos: 'Gómez Díaz',
        correo: `acudiente-${doc}@prueba.edu.co`,
        telefono: '3001234567',
        parentesco: 'MADRE',
      },
      autorizacionTratamientoDatos: true,
      ...cambios,
    };
  }

  const registrar = (cuerpo: object) =>
    api()
      .post('/api/v1/estudiantes')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(cuerpo);

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
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    db = app.get<DataSource>(getDataSourceToken());
    correos = app.get(MailTransport) as InMemoryMailTransport;
    hasher = app.get(PasswordHasher);

    const grupo = await db.query(
      `INSERT INTO grupo (nombre, jornada, hora_salida) VALUES (?, 'MANANA', '12:00:00')`,
      [`Transición E2E ${documento().slice(-5)}`],
    );
    grupoId = Number(grupo.insertId);
    tokenAdmin = (await crearUsuario('ADMINISTRATIVO')).accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('HU01-E1: registra al menor, abre la cuenta del acudiente y este queda habilitado para entrar', async () => {
    const cuerpo = registro();

    const { body } = await registrar(cuerpo).expect(201);

    expect(body.cuentaAcudiente).toBe('CREADA');
    expect(body.ficha).toMatchObject({
      numeroDocumento: cuerpo.numeroDocumento,
      estado: 'ACTIVO',
      grupo: { id: String(grupoId) },
    });
    const titular = body.ficha.acudientes[0];
    expect(titular).toMatchObject({
      titular: true,
      parentesco: 'MADRE',
      estado: 'ACTIVO',
      estadoCuenta: 'PENDIENTE_ACTIVACION',
    });
    expect(body.ficha.autorizacionDatos).toMatchObject({
      versionAviso: expect.any(String),
      revocadoEn: null,
    });

    // El acudiente recibe el enlace, define su contraseña y entra (HU07-E1).
    const token = await tokenDelCorreo(cuerpo.acudiente.correo);
    await api()
      .post('/api/v1/auth/activar')
      .send({ token, contrasena: CLAVE })
      .expect(204);
    const { body: sesion } = await api()
      .post('/api/v1/auth/iniciar-sesion')
      .send({
        numeroDocumento: cuerpo.acudiente.numeroDocumento,
        contrasena: CLAVE,
      })
      .expect(200);
    expect(sesion.usuario.rol).toBe('ACUDIENTE');

    // RNF-04: quedó en la bitácora. RNF-03: sin datos del menor.
    const [auditado] = await db.query(
      `SELECT detalle FROM auditoria
        WHERE accion = 'ESTUDIANTE_REGISTRADO' AND entidad_id = ?`,
      [body.ficha.uuid],
    );
    expect(auditado).toBeDefined();
    // La columna JSON llega como objeto: hay que serializarla para buscar
    // dentro, o la comparación pasaría siempre («[object Object]»).
    const detalle = JSON.stringify(auditado.detalle);
    expect(detalle).not.toContain(cuerpo.nombres);
    expect(detalle).not.toContain(cuerpo.apellidos);
    expect(detalle).not.toContain(cuerpo.numeroDocumento);
  });

  it('reutiliza la cuenta del acudiente para un hermano, sin reenviar la activación', async () => {
    const primero = registro();
    await registrar(primero).expect(201);
    await tokenDelCorreo(primero.acudiente.correo);

    const hermano = registro({ acudiente: primero.acudiente });
    const { body } = await registrar(hermano).expect(201);

    expect(body.cuentaAcudiente).toBe('REUTILIZADA');
    expect(body.ficha.acudientes[0].numeroDocumento).toBe(
      primero.acudiente.numeroDocumento,
    );
    // Una consulta cualquiera da varias vueltas al bucle de eventos: si el
    // registro hubiera disparado otro enlace, ya habría llegado.
    await api()
      .get(`/api/v1/estudiantes/${body.ficha.uuid}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .expect(200);
    expect(correos.filter({ to: primero.acudiente.correo })).toHaveLength(1);
  });

  describe('HU01-E2: validaciones', () => {
    it('rechaza el documento de un estudiante ya registrado y señala el campo', async () => {
      const cuerpo = registro();
      await registrar(cuerpo).expect(201);

      const { body } = await registrar(
        registro({
          numeroDocumento: cuerpo.numeroDocumento,
          acudiente: { ...registro().acudiente },
        }),
      ).expect(409);

      expect(body.campo).toBe('numeroDocumento');
    });

    it('rechaza el documento de un acudiente registrado con datos diferentes', async () => {
      const cuerpo = registro();
      await registrar(cuerpo).expect(201);

      const { body } = await registrar(
        registro({
          acudiente: { ...cuerpo.acudiente, nombres: 'Otra Persona' },
        }),
      ).expect(409);

      expect(body.campo).toBe('acudiente.numeroDocumento');
    });

    it('rechaza un correo que ya usa otra cuenta', async () => {
      const cuerpo = registro();
      await registrar(cuerpo).expect(201);

      const { body } = await registrar(
        registro({
          acudiente: {
            ...registro().acudiente,
            correo: cuerpo.acudiente.correo,
          },
        }),
      ).expect(409);

      expect(body.campo).toBe('acudiente.correo');
    });

    it('rechaza un grupo que no existe', async () => {
      const { body } = await registrar(registro({ grupoId: 999999 })).expect(
        400,
      );

      expect(body.campo).toBe('grupoId');
    });

    it('rechaza el guardado sin los campos obligatorios', async () => {
      await registrar({ nombres: 'Solo el nombre' }).expect(400);
    });

    it('rechaza el guardado sin la autorización de tratamiento de datos', async () => {
      await registrar(registro({ autorizacionTratamientoDatos: false })).expect(
        400,
      );
    });
  });

  describe('HU01-E3: consulta y actualización', () => {
    it('busca por documento y por nombre, y muestra la ficha', async () => {
      const cuerpo = registro();
      await registrar(cuerpo).expect(201);

      for (const termino of [cuerpo.numeroDocumento, cuerpo.apellidos]) {
        const { body } = await api()
          .get('/api/v1/estudiantes')
          .query({ buscar: termino })
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .expect(200);
        expect(body.total).toBe(1);
        expect(body.estudiantes[0]).toMatchObject({
          numeroDocumento: cuerpo.numeroDocumento,
          acudienteTitular: 'Ana María Gómez Díaz',
        });
      }
    });

    it('guarda el cambio de contacto del acudiente y registra quién lo hizo', async () => {
      const cuerpo = registro();
      const { body: creado } = await registrar(cuerpo).expect(201);
      const acudiente = creado.ficha.acudientes[0].uuid;

      const { body: ficha } = await api()
        .patch(
          `/api/v1/estudiantes/${creado.ficha.uuid}/acudientes/${acudiente}`,
        )
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ telefono: '3109876543', estado: 'INACTIVO' })
        .expect(200);

      expect(ficha.acudientes[0]).toMatchObject({
        telefono: '3109876543',
        estado: 'INACTIVO',
      });
      expect(ficha.actualizadoPor).toBe('Prueba E2E');
    });

    it('cambia el grupo del estudiante y deja constancia en la bitácora', async () => {
      const { body: creado } = await registrar(registro()).expect(201);
      const otro = await db.query(
        `INSERT INTO grupo (nombre, jornada, hora_salida) VALUES (?, 'TARDE', '17:00:00')`,
        [`Transición E2E ${documento().slice(-5)}`],
      );

      const { body: ficha } = await api()
        .patch(`/api/v1/estudiantes/${creado.ficha.uuid}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ grupoId: Number(otro.insertId) })
        .expect(200);

      expect(ficha.grupo).toMatchObject({
        jornada: 'TARDE',
        horaSalida: '17:00',
      });
      const [auditado] = await db.query(
        `SELECT detalle FROM auditoria
          WHERE accion = 'ESTUDIANTE_ACTUALIZADO' AND entidad_id = ?`,
        [creado.ficha.uuid],
      );
      expect(JSON.stringify(auditado.detalle)).toContain('grupoId');
    });

    it('un estudiante que no existe es 404', async () => {
      await api()
        .get(`/api/v1/estudiantes/${randomUUID()}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .expect(404);
    });
  });

  describe('HU12-E2: solo el personal administrativo', () => {
    it('un acudiente no puede registrar estudiantes', async () => {
      const acudiente = await crearUsuario('ACUDIENTE');

      await api()
        .post('/api/v1/estudiantes')
        .set('Authorization', `Bearer ${acudiente.accessToken}`)
        .send(registro())
        .expect(403);
      await api()
        .get('/api/v1/estudiantes')
        .set('Authorization', `Bearer ${acudiente.accessToken}`)
        .expect(403);
    });

    it('sin token no se llega a ninguna ruta del módulo', async () => {
      await api().post('/api/v1/estudiantes').send(registro()).expect(401);
      await api().get('/api/v1/estudiantes').expect(401);
      await api().get('/api/v1/grupos').expect(401);
    });

    it('la docente sí puede consultar los grupos (los necesita en portería)', async () => {
      const docente = await crearUsuario('DOCENTE');

      const { body } = await api()
        .get('/api/v1/grupos')
        .set('Authorization', `Bearer ${docente.accessToken}`)
        .expect(200);

      expect(body.some((g: { id: string }) => g.id === String(grupoId))).toBe(
        true,
      );
    });
  });
});
