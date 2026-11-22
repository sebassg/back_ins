import { AsyncLocalStorage } from 'node:async_hooks';

/** Por qué se cerró una sesión (ENUM `sesion.motivo_revocacion`). */
export type MotivoRevocacion =
  | 'CIERRE_SESION'
  | 'USUARIO_DESACTIVADO'
  | 'CAMBIO_CONTRASENA'
  | 'REUSO_DETECTADO'
  | 'ADMINISTRATIVA';

/**
 * Datos de la petición que los stores de `@nestjs/authentication` necesitan
 * y que sus contratos no transportan: con qué dispositivo se abrió una
 * sesión, y por qué se revoca. El servicio de autenticación abre el contexto
 * alrededor de la llamada a `TokenService`, y el store lo lee.
 */
export interface ContextoPeticion {
  ip?: string;
  userAgent?: string;
  dispositivo?: string;
  motivoRevocacion?: MotivoRevocacion;
}

export const contextoPeticion = new AsyncLocalStorage<ContextoPeticion>();

/** Datos del cliente que el controlador extrae de la petición HTTP. */
export interface MetadatosCliente {
  ip?: string;
  userAgent?: string;
  dispositivo?: string;
}
