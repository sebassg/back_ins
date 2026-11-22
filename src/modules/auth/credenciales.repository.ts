import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { filasAfectadas } from '../../common/sql.js';

/**
 * Escrituras sobre `credencial`. Las reglas (cuántos intentos, cuánto
 * bloqueo) son del `AuthService`; aquí solo está cómo escribir sin carreras.
 */
@Injectable()
export class CredencialesRepository {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  /**
   * Suma un intento fallido de forma atómica y devuelve el total. Si había
   * un bloqueo ya vencido, el conteo empieza de nuevo en 1.
   */
  async sumarIntentoFallido(usuarioId: string, ahora: Date): Promise<number> {
    return this.db.transaction(async (tx) => {
      // MariaDB evalúa las asignaciones en orden: la primera lee el bloqueo
      // anterior, la segunda lo limpia si ya venció.
      await tx.query(
        `UPDATE credencial
            SET intentos_fallidos = IF(bloqueado_hasta IS NOT NULL AND bloqueado_hasta <= ?,
                                       1, LEAST(intentos_fallidos + 1, 255)),
                bloqueado_hasta   = IF(bloqueado_hasta <= ?, NULL, bloqueado_hasta)
          WHERE usuario_id = ?`,
        [ahora, ahora, usuarioId],
      );
      const [fila] = await tx.query(
        'SELECT intentos_fallidos FROM credencial WHERE usuario_id = ?',
        [usuarioId],
      );
      return Number(fila?.intentos_fallidos ?? 0);
    });
  }

  async bloquear(usuarioId: string, hasta: Date): Promise<void> {
    await this.db.query(
      'UPDATE credencial SET bloqueado_hasta = ? WHERE usuario_id = ?',
      [hasta, usuarioId],
    );
  }

  async registrarIngreso(usuarioId: string, ahora: Date): Promise<void> {
    await this.db.query(
      `UPDATE credencial
          SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_ingreso_en = ?
        WHERE usuario_id = ?`,
      [ahora, usuarioId],
    );
  }

  /**
   * Nueva contraseña por el enlace de recuperación (HU07-E3). Probar que se
   * controla el correo registrado también levanta el bloqueo por intentos.
   */
  async fijarContrasena(uuid: string, hash: string): Promise<void> {
    await this.db.query(
      `UPDATE credencial c
         JOIN usuario u ON u.id = c.usuario_id
          SET c.hash_contrasena = ?, c.intentos_fallidos = 0, c.bloqueado_hasta = NULL
        WHERE u.uuid = ?`,
      [hash, uuid],
    );
  }

  /**
   * Activación: fija la primera contraseña y pasa la cuenta a ACTIVO, solo
   * si sigue en PENDIENTE_ACTIVACION. `false` si no lo estaba.
   */
  async activar(uuid: string, hash: string): Promise<boolean> {
    const resultado = await this.db.query(
      `UPDATE usuario u
         JOIN credencial c ON c.usuario_id = u.id
          SET c.hash_contrasena = ?, u.estado = 'ACTIVO'
        WHERE u.uuid = ? AND u.estado = 'PENDIENTE_ACTIVACION'`,
      [hash, uuid],
    );
    return filasAfectadas(resultado) > 0;
  }
}
