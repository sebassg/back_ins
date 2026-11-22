import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  AuthenticationStorage,
  type EmailTokenPurpose,
  type EmailTokenRecord,
  type EmailTokenStore,
} from '@nestjs/authentication';
import { DataSource } from 'typeorm';
import { fecha, filasAfectadas } from '../../../common/sql.js';

/** Enlaces pendientes que se conservan por usuario y propósito. */
const MAXIMO_POR_USUARIO = 5;

/**
 * `EmailTokenStore` de `@nestjs/authentication` sobre `token_correo`:
 * enlaces de recuperación (`password-reset`, 30 min, HU07-E3) y de
 * activación de la cuenta (`email-verification`, 72 h).
 *
 * Consumir un enlace es un solo `DELETE … RETURNING`: de varias peticiones
 * con el mismo enlace, exactamente una obtiene la fila.
 */
@Injectable()
export class EmailTokenStoreMariaDb implements EmailTokenStore {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    storage: AuthenticationStorage,
  ) {
    storage.registerSource({ emailTokens: this });
  }

  async saveEmailToken(record: EmailTokenRecord): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Cualquiera puede pedir un enlace: la tabla se mantiene acotada.
      await tx.query('DELETE FROM token_correo WHERE expira_en <= ?', [
        record.createdAt,
      ]);
      const insertado = await tx.query(
        `INSERT INTO token_correo (id, proposito, usuario_id, correo, huella, creado_en, expira_en)
         SELECT ?, ?, u.id, ?, ?, ?, ? FROM usuario u WHERE u.uuid = ?`,
        [
          record.id,
          record.purpose,
          record.email,
          record.fingerprint ?? null,
          record.createdAt,
          record.expiresAt,
          record.userId,
        ],
      );
      if (filasAfectadas(insertado) === 0) {
        throw new Error('saveEmailToken(): el usuario del enlace no existe');
      }
      // Tope por usuario y propósito: se descartan los que vencen primero.
      await tx.query(
        `DELETE tc FROM token_correo tc
           JOIN usuario u ON u.id = tc.usuario_id
           LEFT JOIN (
             SELECT t.id FROM token_correo t
               JOIN usuario u2 ON u2.id = t.usuario_id
              WHERE u2.uuid = ? AND t.proposito = ?
              ORDER BY t.expira_en DESC
              LIMIT ${MAXIMO_POR_USUARIO}
           ) vigentes ON vigentes.id = tc.id
          WHERE u.uuid = ? AND tc.proposito = ? AND vigentes.id IS NULL`,
        [record.userId, record.purpose, record.userId, record.purpose],
      );
    });
  }

  async consumeEmailToken(
    id: string,
    purpose: EmailTokenPurpose,
  ): Promise<EmailTokenRecord | undefined> {
    const [fila] = await this.db.query(
      `DELETE FROM token_correo WHERE id = ? AND proposito = ?
       RETURNING id, proposito, usuario_id, correo, huella, creado_en, expira_en`,
      [id, purpose],
    );
    if (!fila) {
      return undefined;
    }
    // Lectura posterior al consumo atómico: solo traduce el id al uuid.
    const [usuario] = await this.db.query(
      'SELECT uuid FROM usuario WHERE id = ?',
      [fila.usuario_id],
    );
    if (!usuario) {
      return undefined;
    }
    return {
      id: fila.id,
      purpose: fila.proposito,
      userId: usuario.uuid,
      email: fila.correo,
      ...(fila.huella && { fingerprint: fila.huella }),
      createdAt: fecha(fila.creado_en),
      expiresAt: fecha(fila.expira_en),
    };
  }

  async deleteUserEmailTokens(
    userId: string,
    purpose: EmailTokenPurpose,
  ): Promise<void> {
    await this.db.query(
      `DELETE tc FROM token_correo tc
         JOIN usuario u ON u.id = tc.usuario_id
        WHERE u.uuid = ? AND tc.proposito = ?`,
      [userId, purpose],
    );
  }
}
