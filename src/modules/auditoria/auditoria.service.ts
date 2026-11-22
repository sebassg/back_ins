import { Injectable } from '@nestjs/common';
import {
  AuditoriaRepository,
  type RegistroAuditoria,
  type RegistroIntentoLogin,
} from './auditoria.repository.js';

/**
 * Claves que nunca llegan a `auditoria.detalle` (Ley 1581 de 2012, RNF-03):
 * contraseñas, tokens, hashes y secretos, en cualquier nivel del objeto.
 */
const CLAVES_SENSIBLES = /contras|password|token|hash|secret|huella/i;

export function depurarDetalle(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(depurarDetalle);
  }
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(
      Object.entries(valor)
        .filter(([clave]) => !CLAVES_SENSIBLES.test(clave))
        .map(([clave, interno]) => [clave, depurarDetalle(interno)]),
    );
  }
  return valor;
}

/** Bitácora institucional (RNF-04) y bitácora de intentos de ingreso (HU07-E2). */
@Injectable()
export class AuditoriaService {
  constructor(private readonly repositorio: AuditoriaRepository) {}

  registrar(registro: RegistroAuditoria): Promise<void> {
    return this.repositorio.insertar({
      ...registro,
      detalle: registro.detalle
        ? (depurarDetalle(registro.detalle) as Record<string, unknown>)
        : undefined,
    });
  }

  registrarIntento(intento: RegistroIntentoLogin): Promise<void> {
    return this.repositorio.insertarIntento(intento);
  }
}
