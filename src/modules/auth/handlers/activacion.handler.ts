import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  EmailVerificationHandler,
  type EmailVerificationLink,
} from '@nestjs/authentication';
import { UsuariosRepository } from '../../usuarios/usuarios.repository.js';
import { CorreosService } from '../correos.service.js';

/**
 * Activación de la cuenta que creó la institución (db/README.md §3). Usa el
 * flujo de verificación de correo del paquete: el enlace prueba que la
 * persona controla el correo registrado, con vigencia de 72 horas.
 *
 * `markVerified()` no cambia nada: solo confirma que el correo sigue siendo
 * el de la cuenta. La contraseña y el paso a ACTIVO los escribe
 * `AuthService.activar()` después de consumir el enlace. También lo llama
 * `PasswordResetService.reset()`, que no debe activar ni reactivar cuentas.
 */
@Injectable()
export class ActivacionHandler extends EmailVerificationHandler {
  constructor(
    private readonly usuarios: UsuariosRepository,
    private readonly correos: CorreosService,
    registry: AuthenticationRegistry,
  ) {
    super();
    registry.registerHandler('emailVerification', this);
  }

  async send(link: EmailVerificationLink): Promise<void> {
    await this.correos.enviarActivacion(link.email, link.url, link.expiresAt);
  }

  markVerified(userId: string, email: string): Promise<boolean> {
    return this.usuarios.correoVigente(userId, email);
  }
}
