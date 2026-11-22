import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type MotivoFalloLogin =
  | 'CREDENCIAL_INVALIDA'
  | 'USUARIO_INEXISTENTE'
  | 'CUENTA_BLOQUEADA'
  | 'CUENTA_INACTIVA'
  | 'CUENTA_SIN_ACTIVAR';

export interface RegistroAuditoria {
  accion: string;
  usuarioId?: string | null;
  rol?: string | null;
  entidad?: string;
  entidadId?: string;
  detalle?: Record<string, unknown>;
  ip?: string;
}

export interface RegistroIntentoLogin {
  usuarioId: string | null;
  documentoIngresado: string;
  exitoso: boolean;
  motivoFallo?: MotivoFalloLogin;
  ip?: string;
  userAgent?: string;
}

/**
 * Escritura de las dos bitácoras. Solo INSERT: los triggers de la migración
 * 001 rechazan cualquier UPDATE o DELETE sobre ellas (RNF-04).
 */
@Injectable()
export class AuditoriaRepository {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async insertar(registro: RegistroAuditoria): Promise<void> {
    await this.db.query(
      `INSERT INTO auditoria (usuario_id, rol, accion, entidad, entidad_id, detalle, ip)
       VALUES (?, ?, ?, ?, ?, ?, INET6_ATON(?))`,
      [
        registro.usuarioId ?? null,
        registro.rol ?? null,
        registro.accion,
        registro.entidad ?? null,
        registro.entidadId ?? null,
        registro.detalle ? JSON.stringify(registro.detalle) : null,
        registro.ip ?? null,
      ],
    );
  }

  async insertarIntento(intento: RegistroIntentoLogin): Promise<void> {
    await this.db.query(
      `INSERT INTO intento_login
         (usuario_id, documento_ingresado, exitoso, motivo_fallo, ip, user_agent)
       VALUES (?, ?, ?, ?, INET6_ATON(?), ?)`,
      [
        intento.usuarioId,
        intento.documentoIngresado.slice(0, 20),
        intento.exitoso,
        intento.motivoFallo ?? null,
        intento.ip ?? null,
        intento.userAgent?.slice(0, 255) ?? null,
      ],
    );
  }
}
