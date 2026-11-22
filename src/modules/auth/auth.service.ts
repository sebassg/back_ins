import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthenticationEvents,
  EmailVerificationService,
  PasswordHasher,
  PasswordResetService,
  RefreshTokenError,
  TokenService,
  type TokenPair,
} from '@nestjs/authentication';
import type { Subscription } from 'rxjs';
import {
  contextoPeticion,
  type MetadatosCliente,
} from '../../common/contexto-peticion.js';
import type { Env } from '../../config/env.validation.js';
import type { MotivoFalloLogin } from '../auditoria/auditoria.repository.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type { Rol } from '../usuarios/usuario.types.js';
import { UsuariosRepository } from '../usuarios/usuarios.repository.js';
import { CredencialesRepository } from './credenciales.repository.js';

/** HU07-E2: la única respuesta a un inicio de sesión fallido, sea cual sea la causa. */
export const MENSAJE_CREDENCIALES_INVALIDAS =
  'Usuario o contraseña incorrectos';
export const MENSAJE_ENLACE_INVALIDO = 'El enlace no es válido o ya venció';

export interface SesionIniciada extends TokenPair {
  usuario: { uuid: string; nombres: string; apellidos: string; rol: Rol };
}

/**
 * Reglas de acceso de HU07 y HU12. El controlador solo traduce HTTP; los
 * repositorios solo escriben. Todo lo que decide quién entra está aquí.
 */
@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthService.name);
  private readonly maxIntentos: number;
  private readonly bloqueoMs: number;
  private suscripcion?: Subscription;

  constructor(
    private readonly usuarios: UsuariosRepository,
    private readonly credenciales: CredencialesRepository,
    private readonly auditoria: AuditoriaService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly recuperacion: PasswordResetService,
    private readonly activacion: EmailVerificationService,
    private readonly eventos: AuthenticationEvents,
    config: ConfigService<Env, true>,
  ) {
    this.maxIntentos = config.get('MAX_INTENTOS_LOGIN', { infer: true });
    this.bloqueoMs = config.get('BLOQUEO_MINUTOS', { infer: true }) * 60_000;
  }

  /** Un refresh token reusado es un posible robo: queda en la bitácora. */
  onModuleInit(): void {
    this.suscripcion = this.eventos.events$.subscribe((evento) => {
      if (evento.type === 'refresh-token-reused') {
        this.auditoria
          .registrar({
            accion: 'REUSO_REFRESH_TOKEN',
            entidad: 'sesion',
            entidadId: evento.tokenFamilyId,
            detalle: { usuario: evento.userId },
          })
          .catch((error: unknown) =>
            this.logger.error('No se pudo auditar el reuso', error),
          );
      }
    });
  }

  onModuleDestroy(): void {
    this.suscripcion?.unsubscribe();
  }

  /**
   * HU07-E1 / HU12: inicio de sesión con número de documento y contraseña.
   * HU07-E2: mensaje genérico siempre, y bloqueo al quinto fallo.
   */
  async iniciarSesion(
    numeroDocumento: string,
    contrasena: string,
    cliente: MetadatosCliente = {},
  ): Promise<SesionIniciada> {
    const cuenta = await this.usuarios.buscarParaLogin(numeroDocumento);
    // Se verifica siempre, también sin cuenta: así el tiempo de respuesta no
    // revela qué documentos están registrados.
    const contrasenaValida = await this.hasher.verify(
      contrasena,
      cuenta?.hashContrasena ?? undefined,
    );
    const ahora = new Date();

    const fallar = async (motivo: MotivoFalloLogin): Promise<never> => {
      await this.auditoria.registrarIntento({
        usuarioId: cuenta?.id ?? null,
        documentoIngresado: numeroDocumento,
        exitoso: false,
        motivoFallo: motivo,
        ip: cliente.ip,
        userAgent: cliente.userAgent,
      });
      throw new UnauthorizedException(MENSAJE_CREDENCIALES_INVALIDAS);
    };

    if (!cuenta) {
      return fallar('USUARIO_INEXISTENTE');
    }
    if (cuenta.bloqueadoHasta && cuenta.bloqueadoHasta > ahora) {
      return fallar('CUENTA_BLOQUEADA');
    }
    if (cuenta.estado === 'INACTIVO') {
      return fallar('CUENTA_INACTIVA');
    }
    if (cuenta.estado === 'PENDIENTE_ACTIVACION') {
      return fallar('CUENTA_SIN_ACTIVAR');
    }
    if (!contrasenaValida) {
      const intentos = await this.credenciales.sumarIntentoFallido(
        cuenta.id,
        ahora,
      );
      if (intentos >= this.maxIntentos) {
        await this.credenciales.bloquear(
          cuenta.id,
          new Date(ahora.getTime() + this.bloqueoMs),
        );
        if (intentos === this.maxIntentos) {
          await this.auditoria.registrar({
            accion: 'CUENTA_BLOQUEADA',
            usuarioId: cuenta.id,
            rol: cuenta.rol,
            entidad: 'usuario',
            entidadId: cuenta.uuid,
            detalle: { intentos, minutos: this.bloqueoMs / 60_000 },
            ip: cliente.ip,
          });
        }
      }
      return fallar('CREDENCIAL_INVALIDA');
    }

    await this.credenciales.registrarIngreso(cuenta.id, ahora);
    await this.auditoria.registrarIntento({
      usuarioId: cuenta.id,
      documentoIngresado: numeroDocumento,
      exitoso: true,
      ip: cliente.ip,
      userAgent: cliente.userAgent,
    });
    await this.auditoria.registrar({
      accion: 'LOGIN_EXITOSO',
      usuarioId: cuenta.id,
      rol: cuenta.rol,
      entidad: 'usuario',
      entidadId: cuenta.uuid,
      ip: cliente.ip,
    });

    // El store de refresh tokens lee del contexto el dispositivo con el que
    // se abre la sesión.
    const tokens = await contextoPeticion.run({ ...cliente }, () =>
      this.tokens.issue(cuenta.uuid, {
        claims: { rol: cuenta.rol, amr: ['pwd'] },
        method: 'password',
      }),
    );
    return {
      ...tokens,
      usuario: {
        uuid: cuenta.uuid,
        nombres: cuenta.nombres,
        apellidos: cuenta.apellidos,
        rol: cuenta.rol,
      },
    };
  }

  /**
   * Rota el refresh token. El rol se relee de la base de datos y una cuenta
   * que ya no está ACTIVA no renueva (sin gastar el token). Un token ya
   * usado revoca la sesión completa (REUSO_DETECTADO).
   */
  renovar(refreshToken: string): Promise<TokenPair> {
    return contextoPeticion.run({ motivoRevocacion: 'REUSO_DETECTADO' }, () =>
      this.tokens.refresh(refreshToken, {
        claims: async (actuales, uuid) => {
          const usuario = await this.usuarios.buscarEstado(uuid);
          if (!usuario || usuario.estado !== 'ACTIVO') {
            throw new RefreshTokenError('invalid');
          }
          return { ...actuales, rol: usuario.rol };
        },
      }),
    );
  }

  /** Cierra la sesión del dispositivo que presenta el token. No revela si existía. */
  async cerrarSesion(refreshToken: string): Promise<void> {
    await contextoPeticion.run({ motivoRevocacion: 'CIERRE_SESION' }, () =>
      this.tokens.revoke(refreshToken),
    );
  }

  /**
   * HU07-E3: responde igual exista o no el documento, y en el mismo tiempo:
   * la búsqueda y el envío ocurren después de responder. El enlace va al
   * correo REGISTRADO, nunca a uno escrito en el formulario.
   */
  solicitarRecuperacion(numeroDocumento: string): void {
    this.enSegundoPlano('recuperación', async () => {
      const cuenta = await this.usuarios.buscarCorreoPorDocumento(
        numeroDocumento,
        'ACTIVO',
      );
      if (cuenta) {
        this.recuperacion.request(cuenta.correo);
      }
    });
  }

  /**
   * Fija la nueva contraseña con el enlace (30 min, un solo uso). El paquete
   * borra los demás enlaces y revoca todas las sesiones del usuario.
   */
  async restablecerContrasena(
    token: string,
    contrasena: string,
  ): Promise<void> {
    const resultado = await contextoPeticion.run(
      { motivoRevocacion: 'CAMBIO_CONTRASENA' },
      () => this.recuperacion.reset(token, contrasena),
    );
    if (!resultado) {
      throw new BadRequestException(MENSAJE_ENLACE_INVALIDO);
    }
  }

  /** Reenvía el enlace de activación de una cuenta pendiente. Misma respuesta siempre. */
  reenviarActivacion(numeroDocumento: string): void {
    this.enSegundoPlano('activación', async () => {
      const cuenta = await this.usuarios.buscarCorreoPorDocumento(
        numeroDocumento,
        'PENDIENTE_ACTIVACION',
      );
      if (cuenta) {
        await this.activacion.send({ id: cuenta.uuid, email: cuenta.correo });
        await this.auditoria.registrar({
          accion: 'ACTIVACION_ENVIADA',
          entidad: 'usuario',
          entidadId: cuenta.uuid,
        });
      }
    });
  }

  /**
   * La persona define SU contraseña desde el enlace de activación (72 h).
   * Nadie más la conoce en ningún momento (db/README.md §3).
   */
  async activarCuenta(token: string, contrasena: string): Promise<void> {
    // El hash se calcula antes de gastar el enlace.
    const hash = await this.hasher.hash(contrasena);
    const verificado = await this.activacion.verify(token);
    if (
      !verificado ||
      !(await this.credenciales.activar(verificado.userId, hash))
    ) {
      throw new BadRequestException(MENSAJE_ENLACE_INVALIDO);
    }
    await this.auditoria.registrar({
      accion: 'CUENTA_ACTIVADA',
      entidad: 'usuario',
      entidadId: verificado.userId,
    });
  }

  private enSegundoPlano(que: string, tarea: () => Promise<void>): void {
    tarea().catch((error: unknown) =>
      this.logger.error(`Falló el envío del enlace de ${que}`, error),
    );
  }
}
