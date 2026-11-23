import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { RolPolicy } from '../auth/policies/rol.policy.js';
import type { UsuarioAutenticado } from '../usuarios/usuario.types.js';
import {
  type ActualizarAcudienteDto,
  actualizarAcudienteSchema,
  type ActualizarEstudianteDto,
  actualizarEstudianteSchema,
  type BuscarEstudiantesDto,
  buscarEstudiantesSchema,
  type RegistrarEstudianteDto,
  registrarEstudianteSchema,
  uuidAcudiente,
  uuidEstudiante,
} from './dto/estudiante.dto.js';
import type {
  EstudianteRegistrado,
  FichaEstudiante,
  ResumenEstudiante,
} from './estudiante.types.js';
import { EstudiantesService } from './estudiantes.service.js';

/**
 * HU01: gestión de estudiantes y de su acudiente titular. Todo el módulo es
 * del personal administrativo (HU12-E2): los guards son globales y niegan por
 * omisión, así que cada ruta declara su política.
 */
@Can(RolPolicy, 'administrativo')
@Controller('estudiantes')
export class EstudiantesController {
  constructor(private readonly estudiantes: EstudiantesService) {}

  /** HU01-E1: registra al menor, su acudiente titular y la autorización de datos. */
  @Post()
  registrar(
    @Body({ schema: registrarEstudianteSchema }) dto: RegistrarEstudianteDto,
    @CurrentUser() actor: UsuarioAutenticado,
    @Ip() ip: string,
  ): Promise<EstudianteRegistrado> {
    return this.estudiantes.registrar(dto, actor, ip);
  }

  /** HU01-E3: busca por nombre o documento. */
  @Get()
  buscar(
    @Query({ schema: buscarEstudiantesSchema }) filtros: BuscarEstudiantesDto,
  ): Promise<{ total: number; estudiantes: ResumenEstudiante[] }> {
    return this.estudiantes.buscar(filtros);
  }

  /** HU01-E3: la ficha del estudiante. */
  @Get(':uuid')
  ficha(
    @Param('uuid', { schema: uuidEstudiante }) uuid: string,
  ): Promise<FichaEstudiante> {
    return this.estudiantes.ficha(uuid);
  }

  /** HU01-E3: cambia la ficha; queda la fecha y el usuario del cambio. */
  @Patch(':uuid')
  actualizar(
    @Param('uuid', { schema: uuidEstudiante }) uuid: string,
    @Body({ schema: actualizarEstudianteSchema }) dto: ActualizarEstudianteDto,
    @CurrentUser() actor: UsuarioAutenticado,
    @Ip() ip: string,
  ): Promise<FichaEstudiante> {
    return this.estudiantes.actualizar(uuid, dto, actor, ip);
  }

  /** HU01-E3: datos de contacto del acudiente y estado de su vínculo. */
  @Patch(':uuid/acudientes/:uuidAcudiente')
  actualizarAcudiente(
    @Param('uuid', { schema: uuidEstudiante }) uuid: string,
    @Param('uuidAcudiente', { schema: uuidAcudiente }) acudiente: string,
    @Body({ schema: actualizarAcudienteSchema }) dto: ActualizarAcudienteDto,
    @CurrentUser() actor: UsuarioAutenticado,
    @Ip() ip: string,
  ): Promise<FichaEstudiante> {
    return this.estudiantes.actualizarAcudiente(
      uuid,
      acudiente,
      dto,
      actor,
      ip,
    );
  }
}
