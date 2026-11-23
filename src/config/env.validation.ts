import { z } from 'zod';

/**
 * Contrato de configuración de la aplicación. Si falta una variable o viene
 * con un valor inválido, el proceso NO arranca: es preferible fallar al
 * iniciar que descubrir en producción que, por ejemplo, el enlace de
 * recuperación de contraseña nunca venció (HU07-E3).
 *
 * Las duraciones se expresan como las acepta @nestjs/authentication:
 * milisegundos o una cadena tipo '15m', '30m', '30d'.
 */
const duracion = z
  .string()
  .regex(
    /^\d+(ms|s|m|h|d|w)?$/,
    "debe ser una duración como '15m', '30d' o un número en milisegundos",
  );

export const esquemaEnv = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Base de datos. El esquema lo gobiernan los scripts de db/, no TypeORM.
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),

  // Sesión y tokens (HU07, HU12)
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ISSUER: z.url(),
  JWT_AUDIENCE: z.string().min(1),
  ACCESS_TOKEN_TTL: duracion.default('15m'),
  REFRESH_TOKEN_TTL: duracion.default('30d'),
  REFRESH_TOKEN_ABSOLUTE_TTL: duracion.default('90d'),
  SESSION_ABSOLUTE_TTL: duracion.default('7d'),
  SESSION_IDLE_TTL: duracion.default('1d'),

  // Reglas de negocio de HU07
  MAX_INTENTOS_LOGIN: z.coerce.number().int().min(1).default(5),
  BLOQUEO_MINUTOS: z.coerce.number().int().min(1).default(15),
  TOKEN_RECUPERACION_TTL: duracion.default('30m'),
  TOKEN_ACTIVACION_TTL: duracion.default('72h'),
  URL_APP: z.url(),
  URL_RESTABLECER_CONTRASENA: z.url(),

  // Reglas de negocio de HU01. La versión del aviso de privacidad la estampa
  // el servidor en cada autorización de tratamiento de datos: una constancia
  // legal no puede depender de lo que envíe el formulario (Ley 1581 de 2012).
  VERSION_AVISO_PRIVACIDAD: z.string().min(1).max(20).default('2026-11'),

  // Correo saliente
  MAIL_HOST: z.string().default('localhost'),
  MAIL_PORT: z.coerce.number().int().default(1025),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z
    .string()
    .default('Retiro Seguro <no-responder@iestebanochoa.edu.co>'),
});

export type Env = z.infer<typeof esquemaEnv>;

/** Valida el entorno al arrancar; la usa ConfigModule.forRoot({ validate }). */
export function validarEnv(entorno: Record<string, unknown>): Env {
  const resultado = esquemaEnv.safeParse(entorno);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((problema) => `  · ${problema.path.join('.')}: ${problema.message}`)
      .join('\n');
    throw new Error(
      `Configuración inválida (revise su archivo .env):\n${detalle}`,
    );
  }
  return resultado.data;
}
