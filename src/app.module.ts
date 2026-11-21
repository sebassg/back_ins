import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { validarEnv } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { SaludModule } from './salud/salud.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validarEnv,
    }),
    // Límite general de peticiones. El inicio de sesión llevará además su
    // propio límite más estricto y el bloqueo por 5 intentos de HU07-E2.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'general', ttl: 60_000, limit: 100 }],
    }),
    DatabaseModule,
    SaludModule,
    // Próxima tarea: AuthModule (HU07) y UsuariosModule (HU12).
  ],
})
export class AppModule {}
