import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  PasswordResetHandler,
  type PasswordResetAccount,
  type PasswordResetLink,
} from '@nestjs/authentication';
import { AuditoriaService } from '../../auditoria/auditoria.service.js';
import { UsuariosRepository } from '../../usuarios/usuarios.repository.js';
import { CredencialesRepository } from '../credenciales.repository.js';
import { CorreosService } from '../correos.service.js';

/**
 * HU07-E3: lo que `PasswordResetService` le pide a la aplicación. Solo las
 * cuentas ACTIVAS recuperan contraseña: una pendiente se activa con su
 * enlace de activación y una inactiva no vuelve a entrar.
 */
@Injectable()
export class RecuperacionHandler extends PasswordResetHandler {
  constructor(
    private readonly usuarios: UsuariosRepository,
    private readonly credenciales: CredencialesRepository,
    private readonly correos: CorreosService,
    private readonly auditoria: AuditoriaService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('passwordReset', this);
  }

  async findUser(email: string): Promise<PasswordResetAccount | null> {
    const cuenta = await this.usuarios.buscarActivaPorCorreo(email);
    return cuenta
      ? {
          id: cuenta.uuid,
          email: cuenta.correo,
          passwordHash: cuenta.hashContrasena,
        }
      : null;
  }

  async send(link: PasswordResetLink): Promise<void> {
    await this.correos.enviarRecuperacion(link.email, link.url, link.expiresAt);
    await this.auditoria.registrar({
      accion: 'RECUPERACION_SOLICITADA',
      entidad: 'usuario',
      entidadId: link.userId,
    });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.credenciales.fijarContrasena(userId, passwordHash);
    await this.auditoria.registrar({
      accion: 'CONTRASENA_RESTABLECIDA',
      entidad: 'usuario',
      entidadId: userId,
    });
  }
}
