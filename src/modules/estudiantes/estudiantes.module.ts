import { Module } from '@nestjs/common';
import { AuditoriaModule } from '../auditoria/auditoria.module.js';
import { UsuariosModule } from '../usuarios/usuarios.module.js';
import { EstudiantesController } from './estudiantes.controller.js';
import { EstudiantesRepository } from './estudiantes.repository.js';
import { EstudiantesService } from './estudiantes.service.js';
import { GruposController } from './grupos.controller.js';

/**
 * HU01: estudiantes, grupos y su vínculo con los acudientes.
 *
 * La cuenta del acudiente la escribe `UsuariosRepository`, que es de su
 * módulo; aquí se compone la transacción que registra todo de una vez.
 * `EmailVerificationService` viene de `AuthenticationModule`, que es global.
 */
@Module({
  imports: [AuditoriaModule, UsuariosModule],
  controllers: [EstudiantesController, GruposController],
  providers: [EstudiantesRepository, EstudiantesService],
  exports: [EstudiantesRepository],
})
export class EstudiantesModule {}
