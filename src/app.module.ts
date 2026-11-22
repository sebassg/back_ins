import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validarEnv } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { AuditoriaModule } from './modules/auditoria/auditoria.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsuariosModule } from './modules/usuarios/usuarios.module.js';
import { SaludModule } from './salud/salud.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validarEnv,
    }),
    // Límite general de peticiones. El inicio de sesión y los enlaces llevan
    // uno más estricto (@Throttle en AuthController), además del bloqueo por
    // 5 intentos de HU07-E2.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'general', ttl: 60_000, limit: 100 }],
    }),
    DatabaseModule,
    SaludModule,
    AuditoriaModule,
    UsuariosModule,
    AuthModule,
  ],
  providers: [
    // useExisting: así las pruebas pueden sustituirlo con overrideProvider().
    ThrottlerGuard,
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
    // Valida @Body({ schema }) y @Param(..., { schema }) con los esquemas zod.
    { provide: APP_PIPE, useValue: new StandardSchemaValidationPipe() },
  ],
})
export class AppModule {}
