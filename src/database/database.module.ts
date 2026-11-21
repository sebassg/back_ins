import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.validation.js';

/**
 * Conexión a MariaDB.
 *
 * IMPORTANTE: la única fuente de verdad del esquema son los scripts de
 * `db/migrations`. Por eso `synchronize` y `migrationsRun` están en false:
 * TypeORM solo MAPEA tablas que ya existen, nunca las crea ni las altera.
 * Para cambiar el esquema se agrega un script nuevo en db/migrations.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'mariadb' as const,
        host: config.get('DB_HOST', { infer: true }),
        port: config.get('DB_PORT', { infer: true }),
        username: config.get('DB_USER', { infer: true }),
        password: config.get('DB_PASSWORD', { infer: true }),
        database: config.get('DB_NAME', { infer: true }),
        synchronize: false,
        migrationsRun: false,
        autoLoadEntities: true,
        charset: 'utf8mb4',
        // Las fechas se guardan y se leen en UTC (ver convenciones de db/README.md).
        timezone: 'Z',
        logging:
          config.get('NODE_ENV', { infer: true }) === 'development'
            ? (['error', 'warn'] as const)
            : (['error'] as const),
      }),
    }),
  ],
})
export class DatabaseModule {}
