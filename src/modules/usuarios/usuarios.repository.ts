import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { fecha, filasAfectadas } from '../../common/sql.js';
import type {
  CuentaParaLogin,
  EstadoUsuario,
  PerfilUsuario,
  Rol,
} from './usuario.types.js';

/** Una cuenta y el correo registrado al que se le envían los enlaces. */
export interface CuentaConCorreo {
  uuid: string;
  correo: string;
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
  async buscarActivaPorCorreo(
    correo: string,
  ): Promise<{
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
}
