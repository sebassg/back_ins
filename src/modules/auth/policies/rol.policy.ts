import { Policy } from '@nestjs/authorization';
import type { Rol, UsuarioAutenticado } from '../../usuarios/usuario.types.js';

const tiene = (usuario: UsuarioAutenticado | null, ...roles: Rol[]) =>
  usuario !== null && roles.includes(usuario.rol);

/**
 * HU12-E2: cada sección es de un rol. Los permisos viven aquí, en código,
 * sobre el ENUM `usuario.rol`; no hay tablas de permisos (db/README.md §2).
 * Un usuario de otro rol recibe 403; uno sin sesión, 401.
 */
@Policy()
export class RolPolicy {
  /** Cualquier usuario con sesión, sea cual sea su rol. */
  autenticado(usuario: UsuarioAutenticado | null): boolean {
    return usuario !== null;
  }

  /** Secretaría, coordinación y rectoría: cuentas, estudiantes, restricciones, reportes. */
  administrativo(usuario: UsuarioAutenticado | null): boolean {
    return tiene(usuario, 'ADMINISTRATIVO');
  }

  /** Validación en portería y alertas (HU04, HU06). */
  personal(usuario: UsuarioAutenticado | null): boolean {
    return tiene(usuario, 'DOCENTE', 'ADMINISTRATIVO');
  }

  /** Pase QR, terceros autorizados y excusas (HU02, HU03, HU09). */
  acudiente(usuario: UsuarioAutenticado | null): boolean {
    return tiene(usuario, 'ACUDIENTE');
  }
}
