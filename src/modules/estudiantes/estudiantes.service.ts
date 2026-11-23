import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailVerificationService } from '@nestjs/authentication';
import type { Env } from '../../config/env.validation.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import type {
  CuentaExistente,
  NuevoAcudiente,
} from '../usuarios/usuarios.repository.js';
import { UsuariosRepository } from '../usuarios/usuarios.repository.js';
import type { UsuarioAutenticado } from '../usuarios/usuario.types.js';
import type {
  ActualizarAcudienteDto,
  ActualizarEstudianteDto,
  BuscarEstudiantesDto,
  RegistrarEstudianteDto,
} from './dto/estudiante.dto.js';
import type {
  EstudianteRegistrado,
  FichaEstudiante,
  Grupo,
  ResumenEstudiante,
} from './estudiante.types.js';
import {
  type AcudienteDelRegistro,
  ConflictoDeRegistro,
  EstudiantesRepository,
} from './estudiantes.repository.js';

/**
 * HU01-E2 pide «resaltar los campos en conflicto», así que el 409 nombra el
 * campo: la aplicación lo necesita para marcarlo en el formulario. Los campos
 * faltantes ya los reporta el pipe de zod con un 400 por campo.
 */
function conflicto(campo: string, message: string): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    message,
    campo,
  });
}

/** Compara datos personales sin que un espacio o una mayúscula sean «diferentes». */
const igual = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Reglas de HU01: registro, consulta y actualización de estudiantes y de su
 * acudiente titular. El controlador solo traduce HTTP; los repositorios solo
 * escriben. Lo que decide si un registro entra está aquí.
 */
@Injectable()
export class EstudiantesService {
  private readonly logger = new Logger(EstudiantesService.name);
  private readonly versionAviso: string;

  constructor(
    private readonly estudiantes: EstudiantesRepository,
    private readonly usuarios: UsuariosRepository,
    private readonly auditoria: AuditoriaService,
    private readonly activacion: EmailVerificationService,
    config: ConfigService<Env, true>,
  ) {
    this.versionAviso = config.get('VERSION_AVISO_PRIVACIDAD', { infer: true });
  }

  grupos(): Promise<Grupo[]> {
    return this.estudiantes.listarGrupos();
  }

  /**
   * HU01-E1: un solo guardado registra al menor, lo vincula con su acudiente
   * titular, abre la cuenta de ese acudiente si todavía no existe y deja la
   * constancia de tratamiento de datos.
   *
   * Si el acudiente ya tenía cuenta (un hermano ya registrado), se reutiliza y
   * no se le vuelve a enviar el enlace de activación.
   */
  async registrar(
    dto: RegistrarEstudianteDto,
    actor: UsuarioAutenticado,
    ip?: string,
  ): Promise<EstudianteRegistrado> {
    const actorId = await this.idDe(actor);

    if (!(await this.estudiantes.grupoExiste(dto.grupoId))) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'El grupo seleccionado no existe',
        campo: 'grupoId',
      });
    }
    if (await this.estudiantes.documentoRegistrado(dto.numeroDocumento)) {
      throw conflicto(
        'numeroDocumento',
        'Ya existe un estudiante registrado con ese número de documento',
      );
    }

    const existente = await this.usuarios.buscarPorDocumento(
      dto.acudiente.numeroDocumento,
    );
    const acudiente: AcudienteDelRegistro = existente
      ? { existente: this.reutilizable(existente, dto.acudiente).id }
      : { nuevo: await this.cuentaPorAbrir(dto.acudiente) };

    let registro;
    try {
      registro = await this.estudiantes.registrarFicha({
        estudiante: {
          tipoDocumento: dto.tipoDocumento,
          numeroDocumento: dto.numeroDocumento,
          nombres: dto.nombres,
          apellidos: dto.apellidos,
          fechaNacimiento: dto.fechaNacimiento,
          grupoId: dto.grupoId,
        },
        acudiente,
        parentesco: dto.acudiente.parentesco,
        versionAviso: this.versionAviso,
        actorId,
      });
    } catch (error) {
      // La carrera entre dos registros simultáneos la detiene el índice único.
      if (error instanceof ConflictoDeRegistro) {
        throw conflicto(error.campo, error.message);
      }
      throw error;
    }

    const cuentaAcudiente = existente ? 'REUTILIZADA' : 'CREADA';
    const acudienteUuid = registro.acudienteUuid ?? existente?.uuid;

    // RNF-03: la bitácora lleva identificadores, nunca los datos del menor.
    await this.auditoria.registrar({
      accion: 'ESTUDIANTE_REGISTRADO',
      usuarioId: actorId,
      rol: actor.rol,
      entidad: 'estudiante',
      entidadId: registro.estudianteUuid,
      detalle: {
        grupoId: dto.grupoId,
        acudiente: acudienteUuid,
        cuentaAcudiente,
      },
      ip,
    });
    if (cuentaAcudiente === 'CREADA') {
      await this.auditoria.registrar({
        accion: 'USUARIO_CREADO',
        usuarioId: actorId,
        rol: actor.rol,
        entidad: 'usuario',
        entidadId: acudienteUuid,
        detalle: { rol: 'ACUDIENTE', estudiante: registro.estudianteUuid },
        ip,
      });
    }
    await this.auditoria.registrar({
      accion: 'AUTORIZACION_DATOS_REGISTRADA',
      usuarioId: actorId,
      rol: actor.rol,
      entidad: 'estudiante',
      entidadId: registro.estudianteUuid,
      detalle: { versionAviso: this.versionAviso, otorgadoPor: acudienteUuid },
      ip,
    });

    // Después del commit: el store de enlaces consulta `usuario` por fuera de
    // la transacción y no vería la cuenta recién creada.
    if (cuentaAcudiente === 'CREADA' && acudienteUuid) {
      this.enviarActivacion(acudienteUuid, dto.acudiente.correo);
    }

    const ficha = await this.estudiantes.ficha(registro.estudianteUuid);
    if (!ficha) {
      throw new NotFoundException('No se pudo leer la ficha recién creada');
    }
    return { ficha, cuentaAcudiente };
  }

  /** HU01-E3: la ficha del estudiante. */
  async ficha(uuid: string): Promise<FichaEstudiante> {
    const ficha = await this.estudiantes.ficha(uuid);
    if (!ficha) {
      throw new NotFoundException('Estudiante no encontrado');
    }
    return ficha;
  }

  /** HU01-E3: búsqueda por nombre o documento. */
  buscar(
    filtros: BuscarEstudiantesDto,
  ): Promise<{ total: number; estudiantes: ResumenEstudiante[] }> {
    return this.estudiantes.buscar(filtros);
  }

  /** HU01-E3: cambia la ficha y deja registrado quién y cuándo. */
  async actualizar(
    uuid: string,
    dto: ActualizarEstudianteDto,
    actor: UsuarioAutenticado,
    ip?: string,
  ): Promise<FichaEstudiante> {
    const actorId = await this.idDe(actor);
    if (
      dto.grupoId !== undefined &&
      !(await this.estudiantes.grupoExiste(dto.grupoId))
    ) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'El grupo seleccionado no existe',
        campo: 'grupoId',
      });
    }
    if (!(await this.estudiantes.actualizar(uuid, dto, actorId))) {
      throw new NotFoundException('Estudiante no encontrado');
    }
    await this.auditoria.registrar({
      accion: 'ESTUDIANTE_ACTUALIZADO',
      usuarioId: actorId,
      rol: actor.rol,
      entidad: 'estudiante',
      entidadId: uuid,
      detalle: { camposModificados: Object.keys(dto) },
      ip,
    });
    return this.ficha(uuid);
  }

  /**
   * HU01-E3: datos de contacto del acudiente y estado de su vínculo con este
   * estudiante. Desactivar la CUENTA es otra cosa y vive en HU12
   * (`PATCH usuarios/:uuid/desactivar`).
   */
  async actualizarAcudiente(
    estudianteUuid: string,
    acudienteUuid: string,
    dto: ActualizarAcudienteDto,
    actor: UsuarioAutenticado,
    ip?: string,
  ): Promise<FichaEstudiante> {
    const actorId = await this.idDe(actor);
    const vinculo = await this.estudiantes.buscarVinculo(
      estudianteUuid,
      acudienteUuid,
    );
    if (!vinculo) {
      throw new NotFoundException(
        'Ese acudiente no está vinculado con el estudiante',
      );
    }
    if (dto.correo !== undefined) {
      const dueno = await this.usuarios.duenoDelCorreo(dto.correo);
      if (dueno && dueno !== acudienteUuid) {
        throw conflicto(
          'correo',
          'Ya existe una cuenta con ese correo electrónico',
        );
      }
    }

    await this.usuarios.actualizarContacto(vinculo.usuarioId, {
      correo: dto.correo,
      telefono: dto.telefono,
    });
    await this.estudiantes.actualizarVinculo(
      vinculo.estudianteId,
      vinculo.usuarioId,
      { parentesco: dto.parentesco, estado: dto.estado },
    );
    await this.estudiantes.marcarActualizada(vinculo.estudianteId, actorId);
    await this.auditoria.registrar({
      accion: 'ACUDIENTE_ACTUALIZADO',
      usuarioId: actorId,
      rol: actor.rol,
      entidad: 'usuario',
      entidadId: acudienteUuid,
      detalle: {
        estudiante: estudianteUuid,
        camposModificados: Object.keys(dto),
      },
      ip,
    });

    // Cambiar el correo invalida el enlace ya enviado: el token de activación
    // solo sirve para la dirección a la que se envió. Si la cuenta sigue
    // pendiente, hay que mandar uno nuevo o nadie podría activarla.
    const cuenta = await this.usuarios.buscarEstado(acudienteUuid);
    if (dto.correo && cuenta?.estado === 'PENDIENTE_ACTIVACION') {
      this.enviarActivacion(acudienteUuid, dto.correo);
    }
    return this.ficha(estudianteUuid);
  }

  /** `usuario.id` del funcionario de la petición, para las columnas y la bitácora. */
  private async idDe(actor: UsuarioAutenticado): Promise<string> {
    const cuenta = await this.usuarios.buscarEstado(actor.uuid);
    if (!cuenta) {
      throw new NotFoundException('La cuenta de quien registra no existe');
    }
    return cuenta.id;
  }

  /**
   * HU01-E2: el documento ya existe. Se reutiliza la cuenta solo si es de un
   * acudiente y los datos personales coinciden; si no, es el conflicto que el
   * escenario describe («un documento que ya existe con datos diferentes»).
   */
  private reutilizable(
    cuenta: CuentaExistente,
    datos: RegistrarEstudianteDto['acudiente'],
  ): CuentaExistente {
    if (cuenta.rol !== 'ACUDIENTE') {
      throw conflicto(
        'acudiente.numeroDocumento',
        'Ese documento pertenece a una cuenta del personal institucional',
      );
    }
    if (cuenta.estado === 'INACTIVO') {
      throw conflicto(
        'acudiente.numeroDocumento',
        'La cuenta de ese acudiente está desactivada',
      );
    }
    if (
      !igual(cuenta.nombres, datos.nombres) ||
      !igual(cuenta.apellidos, datos.apellidos) ||
      cuenta.tipoDocumento !== datos.tipoDocumento
    ) {
      throw conflicto(
        'acudiente.numeroDocumento',
        'Ese documento ya está registrado con datos diferentes. Verifique el nombre del acudiente',
      );
    }
    return cuenta;
  }

  /** Comprueba que el correo esté libre antes de intentar abrir la cuenta. */
  private async cuentaPorAbrir(
    datos: RegistrarEstudianteDto['acudiente'],
  ): Promise<NuevoAcudiente> {
    if (await this.usuarios.duenoDelCorreo(datos.correo)) {
      throw conflicto(
        'acudiente.correo',
        'Ya existe una cuenta con ese correo electrónico',
      );
    }
    return {
      tipoDocumento: datos.tipoDocumento,
      numeroDocumento: datos.numeroDocumento,
      nombres: datos.nombres,
      apellidos: datos.apellidos,
      correo: datos.correo,
      telefono: datos.telefono,
    };
  }

  /**
   * El enlace de activación va en segundo plano: si el correo falla, el
   * registro no se pierde y la secretaría lo reenvía con
   * `POST auth/reenviar-activacion`.
   */
  private enviarActivacion(uuid: string, correo: string): void {
    this.activacion
      .send({ id: uuid, email: correo })
      .catch((error: unknown) =>
        this.logger.error('Falló el envío del enlace de activación', error),
      );
  }
}
