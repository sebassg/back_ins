import { z } from 'zod';

/** Documento de identidad: el usuario de inicio de sesión (HU07-E1). */
const numeroDocumento = z
  .string()
  .trim()
  .min(3, 'Ingrese su número de documento')
  .max(20, 'Ingrese su número de documento');

/**
 * Contraseña que la persona define al activar o restablecer. El tope de
 * 128 caracteres queda muy por debajo del límite de 4 KiB de PasswordHasher.
 */
const contrasenaNueva = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(128, 'La contraseña no puede superar 128 caracteres');

const tokenEnlace = z.string().min(1).max(512);
const refreshToken = z.string().min(1).max(512);

export const iniciarSesionSchema = z.object({
  numeroDocumento,
  // Al iniciar sesión no se validan las reglas de la contraseña: cualquier
  // rechazo distinto al genérico revelaría información (HU07-E2).
  contrasena: z.string().min(1).max(128),
});
export type IniciarSesionDto = z.infer<typeof iniciarSesionSchema>;

export const refreshTokenSchema = z.object({ refreshToken });
export type RefreshTokenDto = z.infer<typeof refreshTokenSchema>;

export const documentoSchema = z.object({ numeroDocumento });
export type DocumentoDto = z.infer<typeof documentoSchema>;

export const fijarContrasenaSchema = z.object({
  token: tokenEnlace,
  contrasena: contrasenaNueva,
});
export type FijarContrasenaDto = z.infer<typeof fijarContrasenaSchema>;
