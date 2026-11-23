/** ENUM `usuario.rol`: los roles están quemados en la base de datos (db/README.md §2). */
export const ROLES = ['ACUDIENTE', 'DOCENTE', 'ADMINISTRATIVO'] as const;
export type Rol = (typeof ROLES)[number];

export function esRol(valor: unknown): valor is Rol {
  return (
    typeof valor === 'string' && (ROLES as readonly string[]).includes(valor)
  );
}

/**
 * ENUM `usuario.tipo_documento`. `estudiante` reutiliza esta misma lista para
 * no mantener dos catálogos del mismo dato (db/migrations/002).
 */
export const TIPOS_DOCUMENTO = ['CC', 'TI', 'RC', 'CE', 'PA', 'PEP'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** ENUM `usuario.estado`. El bloqueo por intentos NO es un estado: vive en `credencial`. */
export type EstadoUsuario = 'PENDIENTE_ACTIVACION' | 'ACTIVO' | 'INACTIVO';

/**
 * El usuario de una petición autenticada, tal como lo lee `JwtAuth` de los
 * claims del access token, sin consultar la base de datos (RNF-01).
 */
export interface UsuarioAutenticado {
  uuid: string;
  rol: Rol;
}

/** Lo que el inicio de sesión necesita leer de `usuario` y `credencial`. */
export interface CuentaParaLogin {
  id: string;
  uuid: string;
  rol: Rol;
  estado: EstadoUsuario;
  nombres: string;
  apellidos: string;
  hashContrasena: string | null;
  bloqueadoHasta: Date | null;
}

/** Perfil público de un usuario: lo que la app necesita para armar el menú (HU12-E1). */
export interface PerfilUsuario {
  uuid: string;
  tipoDocumento: string;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  correo: string | null;
  rol: Rol;
  estado: EstadoUsuario;
}

declare module '@nestjs/authentication' {
  interface AuthenticationTypes {
    user: UsuarioAutenticado;
  }
}
