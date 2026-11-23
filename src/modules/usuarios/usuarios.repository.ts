import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { fecha, filasAfectadas, idInsertado } from '../../common/sql.js';
import type {
  CuentaParaLogin,
  EstadoUsuario,
  PerfilUsuario,
  Rol,
  TipoDocumento,
} from './usuario.types.js';

/** Una cuenta y el correo registrado al que se le envían los enlaces. */
export interface CuentaConCorreo {
  uuid: string;
  correo: string;
}

/** Los datos personales de una cuenta, para decidir si se puede reutilizar. */
export interface CuentaExistente {
  id: string;
  uuid: string;
  rol: Rol;
  estado: EstadoUsuario;
  tipoDocumento: TipoDocumento;
  nombres: string;
  apellidos: string;
  correo: string | null;
  telefono: string | null;
}

/** Lo que HU01-E1 pide para abrir la cuenta del acudiente titular. */
export interface NuevoAcudiente {
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  correo: string;
  telefono?: string;
}

/**
 * Consultas sobre `usuario` (y `credencial` cuando se lee para entrar). Sin
 * reglas de negocio: deciden los servicios.
 */
@Injectable()
export class UsuariosRepository {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async buscarParaLogin(
    numeroDocumento: string,
  ): Promise<CuentaParaLogin | null> {
    const [fila] = await this.db.query(
      `SELECT u.id, u.uuid, u.rol, u.estado, u.nombres, u.apellidos,
              c.hash_contrasena, c.bloqueado_hasta
         FROM usuario u
         JOIN credencial c ON c.usuario_id = u.id
        WHERE u.numero_documento = ?`,
      [numeroDocumento],
    );
    if (!fila) {
      return null;
    }
    return {
      id: String(fila.id),
      uuid: fila.uuid,
      rol: fila.rol,
      estado: fila.estado,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      hashContrasena: fila.hash_contrasena ?? null,
      bloqueadoHasta: fila.bloqueado_hasta ? fecha(fila.bloqueado_hasta) : null,
    };
  }

  async buscarEstado(
    uuid: string,
  ): Promise<{ id: string; rol: Rol; estado: EstadoUsuario } | null> {
    const [fila] = await this.db.query(
      'SELECT id, rol, estado FROM usuario WHERE uuid = ?',
      [uuid],
    );
    return fila
      ? { id: String(fila.id), rol: fila.rol, estado: fila.estado }
      : null;
  }

  async perfil(uuid: string): Promise<PerfilUsuario | null> {
    const [fila] = await this.db.query(
      `SELECT uuid, tipo_documento, numero_documento, nombres, apellidos, correo, rol, estado
         FROM usuario WHERE uuid = ?`,
      [uuid],
    );
    if (!fila) {
      return null;
    }
    return {
      uuid: fila.uuid,
      tipoDocumento: fila.tipo_documento,
      numeroDocumento: fila.numero_documento,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      correo: fila.correo ?? null,
      rol: fila.rol,
      estado: fila.estado,
    };
  }

  /** La cuenta del documento si está en `estado`, con un correo registrado. */
  async buscarCorreoPorDocumento(
    numeroDocumento: string,
    estado: EstadoUsuario,
  ): Promise<CuentaConCorreo | null> {
    const [fila] = await this.db.query(
      `SELECT uuid, correo FROM usuario
        WHERE numero_documento = ? AND estado = ? AND correo IS NOT NULL`,
      [numeroDocumento, estado],
    );
    return fila ? { uuid: fila.uuid, correo: fila.correo } : null;
  }

  /** Para `PasswordResetHandler.findUser()`: la cuenta ACTIVA con ese correo y su hash. */
  async buscarActivaPorCorreo(correo: string): Promise<{
    uuid: string;
    correo: string;
    hashContrasena: string | null;
  } | null> {
    const [fila] = await this.db.query(
      `SELECT u.uuid, u.correo, c.hash_contrasena
         FROM usuario u
         JOIN credencial c ON c.usuario_id = u.id
        WHERE u.correo = ? AND u.estado = 'ACTIVO'`,
      [correo],
    );
    return fila
      ? {
          uuid: fila.uuid,
          correo: fila.correo,
          hashContrasena: fila.hash_contrasena ?? null,
        }
      : null;
  }

  /** Si el correo sigue siendo el de la cuenta y la cuenta no está desactivada. */
  async correoVigente(uuid: string, correo: string): Promise<boolean> {
    const [fila] = await this.db.query(
      `SELECT 1 AS si FROM usuario
        WHERE uuid = ? AND correo = ? AND estado <> 'INACTIVO'`,
      [uuid, correo],
    );
    return Boolean(fila);
  }

  /**
   * HU12-E3: desactiva la cuenta y cierra todas sus sesiones en una sola
   * transacción. `null` si la cuenta no existe o ya estaba inactiva.
   */
  async desactivarYRevocarSesiones(
    uuid: string,
  ): Promise<{ usuarioId: string; sesionesRevocadas: number } | null> {
    return this.db.transaction(async (tx) => {
      const [fila] = await tx.query(
        `SELECT id FROM usuario WHERE uuid = ? AND estado <> 'INACTIVO' FOR UPDATE`,
        [uuid],
      );
      if (!fila) {
        return null;
      }
      await tx.query(`UPDATE usuario SET estado = 'INACTIVO' WHERE id = ?`, [
        fila.id,
      ]);
      const revocadas = await tx.query(
        `UPDATE sesion
            SET revocada_en = NOW(3), motivo_revocacion = 'USUARIO_DESACTIVADO'
          WHERE usuario_id = ? AND revocada_en IS NULL`,
        [fila.id],
      );
      return {
        usuarioId: String(fila.id),
        sesionesRevocadas: filasAfectadas(revocadas),
      };
    });
  }

  /** La cuenta de un documento, con sus datos personales. Para HU01-E2. */
  async buscarPorDocumento(
    numeroDocumento: string,
  ): Promise<CuentaExistente | null> {
    const [fila] = await this.db.query(
      `SELECT id, uuid, rol, estado, tipo_documento, nombres, apellidos, correo, telefono
         FROM usuario WHERE numero_documento = ?`,
      [numeroDocumento],
    );
    if (!fila) {
      return null;
    }
    return {
      id: String(fila.id),
      uuid: fila.uuid,
      rol: fila.rol,
      estado: fila.estado,
      tipoDocumento: fila.tipo_documento,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      correo: fila.correo ?? null,
      telefono: fila.telefono ?? null,
    };
  }

  /** El `uuid` de quien ya usa ese correo, para no chocar con `uq_usuario_correo`. */
  async duenoDelCorreo(correo: string): Promise<string | null> {
    const [fila] = await this.db.query(
      'SELECT uuid FROM usuario WHERE correo = ?',
      [correo],
    );
    return fila ? fila.uuid : null;
  }

  /**
   * Abre la cuenta del acudiente dentro de una transacción ajena: HU01-E1
   * registra al estudiante y a su acudiente en un solo guardado, y es el
   * repositorio de estudiantes el que es dueño de esa transacción.
   *
   * La cuenta nace en `PENDIENTE_ACTIVACION` y con `hash_contrasena = NULL`,
   * igual que la semilla: nadie, ni quien la crea, conoce una contraseña
   * inicial. La persona la define con el enlace de activación (db/README.md §3).
   */
  async insertarAcudienteEn(
    tx: EntityManager,
    datos: NuevoAcudiente,
    creadoPor: string,
  ): Promise<{ id: string; uuid: string }> {
    const uuid = randomUUID();
    const insercion = await tx.query(
      `INSERT INTO usuario (uuid, tipo_documento, numero_documento, nombres,
                            apellidos, correo, telefono, rol, estado, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACUDIENTE', 'PENDIENTE_ACTIVACION', ?)`,
      [
        uuid,
        datos.tipoDocumento,
        datos.numeroDocumento,
        datos.nombres,
        datos.apellidos,
        datos.correo,
        datos.telefono ?? null,
        creadoPor,
      ],
    );
    const id = idInsertado(insercion);
    // La fila de credencial se crea junto con la cuenta para que el inicio de
    // sesión siempre pueda hacer el JOIN sin casos especiales.
    await tx.query(
      'INSERT INTO credencial (usuario_id, hash_contrasena) VALUES (?, NULL)',
      [id],
    );
    return { id, uuid };
  }

  /**
   * HU01-E3: los datos de contacto del acudiente. Solo toca las columnas que
   * llegan; `undefined` deja la columna como está.
   */
  async actualizarContacto(
    usuarioId: string,
    datos: { correo?: string; telefono?: string | null },
  ): Promise<void> {
    const columnas: string[] = [];
    const valores: unknown[] = [];
    if (datos.correo !== undefined) {
      columnas.push('correo = ?');
      valores.push(datos.correo);
    }
    if (datos.telefono !== undefined) {
      columnas.push('telefono = ?');
      valores.push(datos.telefono);
    }
    if (columnas.length === 0) {
      return;
    }
    await this.db.query(
      `UPDATE usuario SET ${columnas.join(', ')} WHERE id = ?`,
      [...valores, usuarioId],
    );
  }
}
