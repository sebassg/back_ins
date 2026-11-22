import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  AuthenticationStorage,
  type RefreshTokenRecord,
  type RefreshTokenStore,
} from '@nestjs/authentication';
import { DataSource } from 'typeorm';
import {
  contextoPeticion,
  type MotivoRevocacion,
} from '../../../common/contexto-peticion.js';
import { fecha, filasAfectadas, json } from '../../../common/sql.js';

/**
 * `RefreshTokenStore` de `@nestjs/authentication` sobre MariaDB.
 *
 * - La *familia* de tokens es la fila de `sesion`: se crea con el primer
 *   token de un inicio de sesión y es lo que se revoca (HU12-E3).
 * - `userId` es `usuario.uuid` (el `sub` del JWT), nunca el id secuencial.
 * - `claims` pertenecen a la familia (`sesion.claims`): `TokenService` guarda
 *   cada sucesor con los claims vigentes de la familia, y el último gana.
 *
 * Las reglas de cada método están en los typings del paquete; las que
 * importan aquí: marcar un token usado es UNA escritura condicional, y una
 * familia revocada sigue revocada para los tokens que se guarden después
 * (la revocación vive en la sesión, no en los tokens).
 */
@Injectable()
export class RefreshTokenStoreMariaDb implements RefreshTokenStore {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ refreshTokens: this });
  }

  async getRefreshToken(id: string): Promise<RefreshTokenRecord | undefined> {
    const [fila] = await this.db.query(
      `SELECT rt.id, rt.sesion_id, u.uuid, rt.creado_en, rt.expira_en,
              s.expira_en AS sesion_expira_en, rt.usado_en, s.claims
         FROM refresh_token rt
         JOIN sesion s  ON s.id = rt.sesion_id
         JOIN usuario u ON u.id = s.usuario_id
        WHERE rt.id = ?`,
      [id],
    );
    if (!fila) {
      return undefined;
    }
    const claims = json<Record<string, unknown>>(fila.claims);
    return {
      id: fila.id,
      familyId: fila.sesion_id,
      userId: fila.uuid,
      createdAt: fecha(fila.creado_en),
      expiresAt: fecha(fila.expira_en),
      familyExpiresAt: fecha(fila.sesion_expira_en),
      ...(fila.usado_en && { usedAt: fecha(fila.usado_en) }),
      ...(claims && { claims }),
    };
  }

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    const contexto = contextoPeticion.getStore();
    await this.db.transaction(async (tx) => {
      // Mantiene acotada la tabla: los tokens de sesiones que ya pasaron su
      // techo absoluto no sirven para nada. Las filas de `sesion` se quedan
      // como historial de dispositivos.
      await tx.query(
        `DELETE rt FROM refresh_token rt
           JOIN sesion s ON s.id = rt.sesion_id
          WHERE s.expira_en <= ?`,
        [record.createdAt],
      );
      // El primer token de la familia abre la sesión con los datos del
      // dispositivo; los sucesores solo registran el último uso y los claims.
      const sesion = await tx.query(
        `INSERT INTO sesion (id, usuario_id, creado_en, expira_en, claims, ip, user_agent, dispositivo)
         SELECT ?, u.id, ?, ?, ?, INET6_ATON(?), ?, ?
           FROM usuario u WHERE u.uuid = ?
         ON DUPLICATE KEY UPDATE ultimo_uso_en = VALUES(creado_en), claims = VALUES(claims)`,
        [
          record.familyId,
          record.createdAt,
          record.familyExpiresAt,
          record.claims ? JSON.stringify(record.claims) : null,
          contexto?.ip ?? null,
          contexto?.userAgent?.slice(0, 255) ?? null,
          contexto?.dispositivo?.slice(0, 100) ?? null,
          record.userId,
        ],
      );
      if (filasAfectadas(sesion) === 0) {
        throw new Error(
          'saveRefreshToken(): el usuario de la familia no existe',
        );
      }
      await tx.query(
        `INSERT INTO refresh_token (id, sesion_id, creado_en, expira_en, usado_en)
         VALUES (?, ?, ?, ?, ?)`,
        [
          record.id,
          record.familyId,
          record.createdAt,
          record.expiresAt,
          record.usedAt ?? null,
        ],
      );
    });
  }

  async markRefreshTokenUsed(id: string, at: Date): Promise<boolean> {
    const resultado = await this.db.query(
      'UPDATE refresh_token SET usado_en = ? WHERE id = ? AND usado_en IS NULL',
      [at, id],
    );
    return filasAfectadas(resultado) === 1;
  }

  async revokeRefreshTokenFamily(familyId: string): Promise<void> {
    await this.db.query(
      `UPDATE sesion SET revocada_en = NOW(3), motivo_revocacion = ?
        WHERE id = ? AND revocada_en IS NULL`,
      [this.motivo('ADMINISTRATIVA'), familyId],
    );
  }

  async isRefreshTokenFamilyRevoked(familyId: string): Promise<boolean> {
    const [fila] = await this.db.query(
      'SELECT revocada_en FROM sesion WHERE id = ?',
      [familyId],
    );
    return Boolean(fila?.revocada_en);
  }

  async revokeUserRefreshTokens(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE sesion s
         JOIN usuario u ON u.id = s.usuario_id
          SET s.revocada_en = NOW(3), s.motivo_revocacion = ?
        WHERE u.uuid = ? AND s.revocada_en IS NULL`,
      [this.motivo('ADMINISTRATIVA'), userId],
    );
  }

  /** El motivo que fijó el servicio al abrir el contexto, o el de omisión. */
  private motivo(omision: MotivoRevocacion): MotivoRevocacion {
    return contextoPeticion.getStore()?.motivoRevocacion ?? omision;
  }
}
