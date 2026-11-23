import { Controller, Get } from '@nestjs/common';
import { Can } from '@nestjs/authorization';
import { RolPolicy } from '../auth/policies/rol.policy.js';
import type { Grupo } from './estudiante.types.js';
import { EstudiantesService } from './estudiantes.service.js';

/**
 * Los grupos de preescolar, para poder elegir el del estudiante al
 * registrarlo (HU01-E1). Su gestión —crear grupos, asignar la docente
 * titular, cambiar la hora de salida— es de HU11.
 */
@Controller('grupos')
export class GruposController {
  constructor(private readonly estudiantes: EstudiantesService) {}

  /** Lo ve también la docente: necesita su grupo para la portería (HU04). */
  @Can(RolPolicy, 'personal')
  @Get()
  listar(): Promise<Grupo[]> {
    return this.estudiantes.grupos();
  }
}
