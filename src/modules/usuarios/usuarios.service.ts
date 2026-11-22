import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { PerfilUsuario, UsuarioAutenticado } from './usuario.types.js';
import { UsuariosRepository } from './usuarios.repository.js';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly usuarios: UsuariosRepository,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** HU12-E1: el perfil y el rol con los que la app arma el menú. */
  async perfil(uuid: string): Promise<PerfilUsuario> {
    const perfil = await this.usuarios.perfil(uuid);
    if (!perfil) {
      throw new NotFoundException('Usuario no encontrado');
    }
    return perfil;
  }

  /**
   * HU12-E3: desactiva a un funcionario y cierra todas sus sesiones. Sus
   * access tokens vigentes expiran solos en 15 minutos como máximo; ninguna
   * renovación posterior funciona, porque la sesión quedó revocada.
   */
  async desactivar(
    uuid: string,
    actor: UsuarioAutenticado,
    ip?: string,
  ): Promise<void> {
    if (uuid === actor.uuid) {
      throw new BadRequestException('No puede desactivar su propia cuenta');
    }
    const resultado = await this.usuarios.desactivarYRevocarSesiones(uuid);
    if (!resultado) {
      throw new NotFoundException('Usuario no encontrado o ya inactivo');
    }
    const actorDb = await this.usuarios.buscarEstado(actor.uuid);
    await this.auditoria.registrar({
      accion: 'USUARIO_DESACTIVADO',
      usuarioId: actorDb?.id ?? null,
      rol: actor.rol,
      entidad: 'usuario',
      entidadId: uuid,
      detalle: { sesionesRevocadas: resultado.sesionesRevocadas },
      ip,
    });
  }
}
