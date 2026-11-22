import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
} from '@nestjs/common';
import { Public, type TokenPair } from '@nestjs/authentication';
import { Throttle } from '@nestjs/throttler';
import { AuthService, type SesionIniciada } from './auth.service.js';
import {
  documentoSchema,
  fijarContrasenaSchema,
  iniciarSesionSchema,
  refreshTokenSchema,
  type DocumentoDto,
  type FijarContrasenaDto,
  type IniciarSesionDto,
  type RefreshTokenDto,
} from './dto/auth.dto.js';

/** Límite estricto para las rutas que se pueden usar para adivinar o inundar. */
const LIMITE_ESTRICTO = { general: { limit: 10, ttl: 60_000 } };

const RESPUESTA_ENLACE = {
  mensaje:
    'Si el documento está registrado, enviamos un enlace al correo registrado en la institución.',
};

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** HU07-E1 / HU12-E1: documento y contraseña; devuelve tokens y el rol. */
  @Throttle(LIMITE_ESTRICTO)
  @Post('iniciar-sesion')
  @HttpCode(HttpStatus.OK)
  iniciarSesion(
    @Body({ schema: iniciarSesionSchema }) dto: IniciarSesionDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-dispositivo') dispositivo?: string,
  ): Promise<SesionIniciada> {
    return this.auth.iniciarSesion(dto.numeroDocumento, dto.contrasena, {
      ip,
      userAgent,
      dispositivo,
    });
  }

  @Post('renovar')
  @HttpCode(HttpStatus.OK)
  renovar(
    @Body({ schema: refreshTokenSchema }) dto: RefreshTokenDto,
  ): Promise<TokenPair> {
    return this.auth.renovar(dto.refreshToken);
  }

  @Post('cerrar-sesion')
  @HttpCode(HttpStatus.NO_CONTENT)
  cerrarSesion(
    @Body({ schema: refreshTokenSchema }) dto: RefreshTokenDto,
  ): Promise<void> {
    return this.auth.cerrarSesion(dto.refreshToken);
  }

  /** HU07-E3: la respuesta es la misma exista o no el documento. */
  @Throttle(LIMITE_ESTRICTO)
  @Post('recuperar-contrasena')
  @HttpCode(HttpStatus.ACCEPTED)
  recuperarContrasena(@Body({ schema: documentoSchema }) dto: DocumentoDto) {
    this.auth.solicitarRecuperacion(dto.numeroDocumento);
    return RESPUESTA_ENLACE;
  }

  @Throttle(LIMITE_ESTRICTO)
  @Post('restablecer-contrasena')
  @HttpCode(HttpStatus.NO_CONTENT)
  restablecerContrasena(
    @Body({ schema: fijarContrasenaSchema }) dto: FijarContrasenaDto,
  ): Promise<void> {
    return this.auth.restablecerContrasena(dto.token, dto.contrasena);
  }

  @Throttle(LIMITE_ESTRICTO)
  @Post('reenviar-activacion')
  @HttpCode(HttpStatus.ACCEPTED)
  reenviarActivacion(@Body({ schema: documentoSchema }) dto: DocumentoDto) {
    this.auth.reenviarActivacion(dto.numeroDocumento);
    return RESPUESTA_ENLACE;
  }

  @Throttle(LIMITE_ESTRICTO)
  @Post('activar')
  @HttpCode(HttpStatus.NO_CONTENT)
  activar(
    @Body({ schema: fijarContrasenaSchema }) dto: FijarContrasenaDto,
  ): Promise<void> {
    return this.auth.activarCuenta(dto.token, dto.contrasena);
  }
}
