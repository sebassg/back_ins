import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthenticationModule,
  AuthenticationStorage,
  InMemorySessionStore,
} from '@nestjs/authentication';
import { AuthorizationModule } from '@nestjs/authorization';
import { InMemoryMailTransport, MailModule, SmtpTransport } from '@nestjs/mail';
import type { Env } from '../../config/env.validation.js';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { UsuariosModule } from '../usuarios/usuarios.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CorreosService } from './correos.service.js';
import { CredencialesRepository } from './credenciales.repository.js';
import { ActivacionHandler } from './handlers/activacion.handler.js';
import { RecuperacionHandler } from './handlers/recuperacion.handler.js';
import { JwtAuth } from './jwt.provider.js';
import { RolPolicy } from './policies/rol.policy.js';
import { EmailTokenStoreMariaDb } from './stores/email-token.store.js';
import { RefreshTokenStoreMariaDb } from './stores/refresh-token.store.js';

/**
 * No hay sesión por cookie: la app y el panel usan access token + refresh
 * token. Pero `PasswordResetService` cierra también las sesiones de cookie
 * al restablecer, y por eso exige un store `sessions`. Se registra uno en
 * memoria que siempre está vacío, para que producción no lo rechace.
 */
const SIN_SESIONES_COOKIE = {
  provide: 'SIN_SESIONES_COOKIE',
  inject: [AuthenticationStorage],
  useFactory: (storage: AuthenticationStorage) => {
    storage.registerSource({ sessions: new InMemorySessionStore() });
    return true;
  },
};

@Module({
  imports: [
    AuthenticationModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        accessToken: {
          key: config.get('JWT_SECRET', { infer: true }),
          issuer: config.get('JWT_ISSUER', { infer: true }),
          audience: config.get('JWT_AUDIENCE', { infer: true }),
          ttl: config.get('ACCESS_TOKEN_TTL', { infer: true }),
        },
        refreshToken: {
          ttl: config.get('REFRESH_TOKEN_TTL', { infer: true }),
          absoluteTtl: config.get('REFRESH_TOKEN_ABSOLUTE_TTL', {
            infer: true,
          }),
        },
        // HU07-E3: enlace de 30 minutos y de un solo uso.
        passwordReset: {
          url: config.get('URL_RESTABLECER_CONTRASENA', { infer: true }),
          ttl: config.get('TOKEN_RECUPERACION_TTL', { infer: true }),
        },
        // Activación de la cuenta creada por la institución: 72 horas.
        emailVerification: {
          url: new URL(
            '/activar-cuenta',
            config.get('URL_APP', { infer: true }),
          ).toString(),
          ttl: config.get('TOKEN_ACTIVACION_TTL', { infer: true }),
        },
      }),
    }),
    AuthorizationModule.forRoot(),
    MailModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const usuario = config.get('MAIL_USER', { infer: true });
        const clave = config.get('MAIL_PASSWORD', { infer: true });
        return {
          from: config.get('MAIL_FROM', { infer: true }),
          // En las pruebas los correos se quedan en memoria para leer los enlaces.
          transport:
            config.get('NODE_ENV', { infer: true }) === 'test'
              ? new InMemoryMailTransport()
              : new SmtpTransport({
                  host: config.get('MAIL_HOST', { infer: true }),
                  port: config.get('MAIL_PORT', { infer: true }),
                  startTls: 'opportunistic',
                  ...(usuario &&
                    clave && { auth: { user: usuario, pass: clave } }),
                }),
        };
      },
    }),
    AuditoriaModule,
    UsuariosModule,
  ],
  controllers: [AuthController],
  providers: [
    SIN_SESIONES_COOKIE,
    RefreshTokenStoreMariaDb,
    EmailTokenStoreMariaDb,
    JwtAuth,
    RolPolicy,
    RecuperacionHandler,
    ActivacionHandler,
    CorreosService,
    CredencialesRepository,
    AuthService,
  ],
})
export class AuthModule {}
