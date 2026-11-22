import { Injectable } from '@nestjs/common';
import {
  AuthenticationRegistry,
  JwtBearerProvider,
  type JwtClaims,
} from '@nestjs/authentication';
import { esRol, type UsuarioAutenticado } from '../usuarios/usuario.types.js';

/**
 * Lee el usuario del access token (`Authorization: Bearer …`) sin consultar
 * la base de datos (RNF-01). El rol viene en los claims; al renovar, el
 * `AuthService` lo vuelve a leer de `usuario`, así que un cambio de rol o una
 * desactivación se nota a más tardar al vencer el access token (15 min).
 */
@Injectable()
export class JwtAuth extends JwtBearerProvider<UsuarioAutenticado> {
  constructor(registry: AuthenticationRegistry) {
    super();
    registry.registerProvider(this);
  }

  protected validate(claims: JwtClaims): UsuarioAutenticado | null {
    if (typeof claims.sub !== 'string' || !esRol(claims.rol)) {
      return null;
    }
    return { uuid: claims.sub, rol: claims.rol };
  }
}
