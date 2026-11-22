import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
} from '@nestjs/common';
import { CurrentUser } from '@nestjs/authentication';
import { Can } from '@nestjs/authorization';
import { z } from 'zod';
import { RolPolicy } from '../auth/policies/rol.policy.js';
import type { PerfilUsuario, UsuarioAutenticado } from './usuario.types.js';
import { UsuariosService } from './usuarios.service.js';

const uuidUsuario = z.uuid({ message: 'Identificador de usuario inválido' });

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  /** HU12-E1: quién soy y con qué rol, para armar el menú. */
  @Can(RolPolicy, 'autenticado')
  @Get('yo')
  yo(@CurrentUser() usuario: UsuarioAutenticado): Promise<PerfilUsuario> {
    return this.usuarios.perfil(usuario.uuid);
  }

  /** HU12-E3: desactivar un funcionario cierra todas sus sesiones. */
  @Can(RolPolicy, 'administrativo')
  @Patch(':uuid/desactivar')
  @HttpCode(HttpStatus.NO_CONTENT)
  desactivar(
    @Param('uuid', { schema: uuidUsuario }) uuid: string,
    @CurrentUser() actor: UsuarioAutenticado,
    @Ip() ip: string,
  ): Promise<void> {
    return this.usuarios.desactivar(uuid, actor, ip);
  }
}
