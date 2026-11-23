import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { fecha, filasAfectadas, idInsertado } from '../../common/sql.js';
import {
  type NuevoAcudiente,
  UsuariosRepository,
} from '../usuarios/usuarios.repository.js';
import type { TipoDocumento } from '../usuarios/usuario.types.js';
import type {
  AcudienteDeEstudiante,
  EstadoEstudiante,
  EstadoVinculo,
  FichaEstudiante,
  Grupo,
  Parentesco,
  ResumenEstudiante,
} from './estudiante.types.js';

/**
 * Una llave única de la base de datos rechazó la escritura. Lleva el campo
 * para que HU01-E2 pueda señalarlo en el formulario; que eso sea un 409 lo
 * decide el servicio, no el repositorio.
 */
export class ConflictoDeRegistro extends Error {
  constructor(
    readonly campo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ConflictoDeRegistro';
  }
}

/** Qué significa cada llave única cuando MariaDB la rechaza (errno 1062). */
const CONFLICTOS: Record<string, { campo: string; mensaje: string }> = {
  uq_estudiante_documento: {
    campo: 'numeroDocumento',
    mensaje: 'Ya existe un estudiante registrado con ese número de documento',
  },
  uq_usuario_documento: {
    campo: 'acudiente.numeroDocumento',
    mensaje: 'Ya existe una cuenta con ese número de documento',
  },
  uq_usuario_correo: {
    campo: 'acudiente.correo',
    mensaje: 'Ya existe una cuenta con ese correo electrónico',
  },
  uq_titular_por_estudiante: {
    campo: 'acudiente',
    mensaje: 'El estudiante ya tiene un acudiente titular',
  },
};

/**
 * Traduce el error de llave duplicada. Cubre la carrera entre dos registros
 * simultáneos del mismo documento: las validaciones del servicio son para dar
 * un mensaje útil, la garantía es el índice único.
 */
function comoConflicto(error: unknown): ConflictoDeRegistro | null {
  const { errno, message } =
    (error as { errno?: number; message?: string }) ?? {};
  if (errno !== 1062) {
    return null;
  }
  for (const [llave, { campo, mensaje }] of Object.entries(CONFLICTOS)) {
    if (message?.includes(llave)) {
      return new ConflictoDeRegistro(campo, mensaje);
    }
  }
  return new ConflictoDeRegistro('', 'El registro duplica datos existentes');
}

export interface NuevoEstudiante {
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento?: string;
  grupoId: number;
}

/** El acudiente del registro: una cuenta que ya existe, o una por abrir. */
export type AcudienteDelRegistro =
  { existente: string } | { nuevo: NuevoAcudiente };

export interface DatosDelRegistro {
  estudiante: NuevoEstudiante;
  acudiente: AcudienteDelRegistro;
  parentesco: Parentesco;
  versionAviso: string;
  /** `usuario.id` del funcionario que registra (HU01-E1). */
  actorId: string;
}

/** Lo que el vínculo necesita saber para poder actualizarse (HU01-E3). */
export interface VinculoLocalizado {
  estudianteId: string;
  usuarioId: string;
  titular: boolean;
  estado: EstadoVinculo;
}

/**
 * Acceso a `estudiante`, `grupo`, `acudiente_estudiante` y
 * `autorizacion_tratamiento_datos`. Sin reglas de negocio: deciden los
 * servicios. Aquí solo está cómo escribir sin dejar estados a medias.
 */
@Injectable()
export class EstudiantesRepository {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly usuarios: UsuariosRepository,
  ) {}

  async listarGrupos(): Promise<Grupo[]> {
    const filas = await this.db.query(
      `SELECT id, nombre, jornada, TIME_FORMAT(hora_salida, '%H:%i') AS hora_salida
         FROM grupo ORDER BY nombre`,
    );
    return filas.map((fila: Record<string, string>): Grupo => ({
      id: String(fila.id),
      nombre: fila.nombre,
      jornada: fila.jornada as Grupo['jornada'],
      horaSalida: fila.hora_salida,
    }));
  }

  async grupoExiste(grupoId: number): Promise<boolean> {
    const [fila] = await this.db.query(
      'SELECT 1 AS si FROM grupo WHERE id = ?',
      [grupoId],
    );
    return Boolean(fila);
  }

  async documentoRegistrado(numeroDocumento: string): Promise<boolean> {
    const [fila] = await this.db.query(
      'SELECT 1 AS si FROM estudiante WHERE numero_documento = ?',
      [numeroDocumento],
    );
    return Boolean(fila);
  }

  /**
   * HU01-E1 en un solo guardado: la ficha del menor, la cuenta del acudiente
   * titular (si hay que abrirla), el vínculo entre los dos y la constancia de
   * tratamiento de datos. O entra todo, o no entra nada.
   *
   * El correo de activación NO se envía aquí: hay que esperar el commit,
   * porque el store de enlaces consulta `usuario` por fuera de esta
   * transacción y no vería la fila. Lo hace el servicio.
   */
  async registrarFicha(datos: DatosDelRegistro): Promise<{
    estudianteId: string;
    estudianteUuid: string;
    acudienteId: string;
    acudienteUuid: string | null;
  }> {
    const { estudiante, actorId } = datos;
    const estudianteUuid = randomUUID();
    try {
      return await this.db.transaction(async (tx) => {
        const insercion = await tx.query(
          `INSERT INTO estudiante (uuid, tipo_documento, numero_documento, nombres,
                                   apellidos, fecha_nacimiento, grupo_id, creado_por)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            estudianteUuid,
            estudiante.tipoDocumento,
            estudiante.numeroDocumento,
            estudiante.nombres,
            estudiante.apellidos,
            estudiante.fechaNacimiento ?? null,
            estudiante.grupoId,
            actorId,
          ],
        );
        const estudianteId = idInsertado(insercion);

        const acudiente =
          'existente' in datos.acudiente
            ? { id: datos.acudiente.existente, uuid: null }
            : await this.usuarios.insertarAcudienteEn(
                tx,
                datos.acudiente.nuevo,
                actorId,
              );

        await tx.query(
          `INSERT INTO acudiente_estudiante
             (estudiante_id, usuario_id, parentesco, titular)
           VALUES (?, ?, ?, TRUE)`,
          [estudianteId, acudiente.id, datos.parentesco],
        );

        await tx.query(
          `INSERT INTO autorizacion_tratamiento_datos
             (estudiante_id, otorgado_por, registrado_por, version_aviso)
           VALUES (?, ?, ?, ?)`,
          [estudianteId, acudiente.id, actorId, datos.versionAviso],
        );

        return {
          estudianteId,
          estudianteUuid,
          acudienteId: acudiente.id,
          acudienteUuid: acudiente.uuid,
        };
      });
    } catch (error) {
      const conflicto = comoConflicto(error);
      throw conflicto ?? error;
    }
  }

  /** La ficha completa de HU01-E3. `null` si no existe el estudiante. */
  async ficha(uuid: string): Promise<FichaEstudiante | null> {
    const [fila] = await this.db.query(
      `SELECT e.id, e.uuid, e.tipo_documento, e.numero_documento, e.nombres,
              e.apellidos, DATE_FORMAT(e.fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
              e.estado, e.creado_en, e.actualizado_en,
              g.id AS grupo_id, g.nombre AS grupo_nombre, g.jornada,
              TIME_FORMAT(g.hora_salida, '%H:%i') AS hora_salida,
              CONCAT(a.nombres, ' ', a.apellidos) AS actualizado_por
         FROM estudiante e
         LEFT JOIN grupo   g ON g.id = e.grupo_id
         LEFT JOIN usuario a ON a.id = e.actualizado_por
        WHERE e.uuid = ?`,
      [uuid],
    );
    if (!fila) {
      return null;
    }
    const [acudientes, autorizacion] = await Promise.all([
      this.acudientesDe(String(fila.id)),
      this.autorizacionDe(String(fila.id)),
    ]);
    return {
      uuid: fila.uuid,
      tipoDocumento: fila.tipo_documento,
      numeroDocumento: fila.numero_documento,
      nombres: fila.nombres,
      apellidos: fila.apellidos,
      fechaNacimiento: fila.fecha_nacimiento ?? null,
      estado: fila.estado,
      grupo: fila.grupo_id
        ? {
            id: String(fila.grupo_id),
            nombre: fila.grupo_nombre,
            jornada: fila.jornada,
            horaSalida: fila.hora_salida,
          }
        : null,
      acudientes,
      autorizacionDatos: autorizacion,
      creadoEn: fecha(fila.creado_en),
      actualizadoEn: fecha(fila.actualizado_en),
      actualizadoPor: fila.actualizado_por ?? null,
    };
  }

  private async acudientesDe(
    estudianteId: string,
  ): Promise<AcudienteDeEstudiante[]> {
    const filas = await this.db.query(
      `SELECT u.uuid, u.tipo_documento, u.numero_documento, u.nombres, u.apellidos,
              u.correo, u.telefono, u.estado AS estado_cuenta,
              v.parentesco, v.titular, v.estado
         FROM acudiente_estudiante v
         JOIN usuario u ON u.id = v.usuario_id
        WHERE v.estudiante_id = ?
        ORDER BY v.titular DESC, u.apellidos`,
      [estudianteId],
    );
    return filas.map(
      (fila: Record<string, unknown>): AcudienteDeEstudiante => ({
        uuid: fila.uuid as string,
        tipoDocumento: fila.tipo_documento as TipoDocumento,
        numeroDocumento: fila.numero_documento as string,
        nombres: fila.nombres as string,
        apellidos: fila.apellidos as string,
        correo: (fila.correo as string) ?? null,
        telefono: (fila.telefono as string) ?? null,
        parentesco: fila.parentesco as Parentesco,
        titular: Boolean(fila.titular),
        estado: fila.estado as EstadoVinculo,
        estadoCuenta:
          fila.estado_cuenta as AcudienteDeEstudiante['estadoCuenta'],
      }),
    );
  }

  private async autorizacionDe(
    estudianteId: string,
  ): Promise<FichaEstudiante['autorizacionDatos']> {
    const [fila] = await this.db.query(
      `SELECT a.otorgado_en, a.version_aviso, a.revocado_en,
              CONCAT(u.nombres, ' ', u.apellidos) AS otorgado_por
         FROM autorizacion_tratamiento_datos a
         JOIN usuario u ON u.id = a.otorgado_por
        WHERE a.estudiante_id = ?
        ORDER BY a.otorgado_en DESC
        LIMIT 1`,
      [estudianteId],
    );
    return fila
      ? {
          otorgadoEn: fecha(fila.otorgado_en),
          otorgadoPor: fila.otorgado_por,
          versionAviso: fila.version_aviso,
          revocadoEn: fila.revocado_en ? fecha(fila.revocado_en) : null,
        }
      : null;
  }

  /** HU01-E3: «busca al estudiante por nombre o documento». */
  async buscar(filtros: {
    buscar?: string;
    grupoId?: number;
    pagina: number;
    porPagina: number;
  }): Promise<{ total: number; estudiantes: ResumenEstudiante[] }> {
    const patron = filtros.buscar ? `%${filtros.buscar}%` : null;
    const grupoId = filtros.grupoId ?? null;
    const condicion = `WHERE (? IS NULL
                          OR e.numero_documento LIKE ?
                          OR CONCAT(e.nombres, ' ', e.apellidos) LIKE ?)
                         AND (? IS NULL OR e.grupo_id = ?)`;
    const parametros = [patron, patron, patron, grupoId, grupoId];

    const [conteo] = await this.db.query(
      `SELECT COUNT(*) AS total FROM estudiante e ${condicion}`,
      parametros,
    );
    const filas = await this.db.query(
      `SELECT e.uuid, e.numero_documento, e.nombres, e.apellidos, e.estado,
              g.nombre AS grupo,
              CONCAT(t.nombres, ' ', t.apellidos) AS titular
         FROM estudiante e
         LEFT JOIN grupo g ON g.id = e.grupo_id
         LEFT JOIN acudiente_estudiante v
                ON v.estudiante_id = e.id AND v.titular IS TRUE
         LEFT JOIN usuario t ON t.id = v.usuario_id
         ${condicion}
        ORDER BY e.apellidos, e.nombres
        LIMIT ? OFFSET ?`,
      [
        ...parametros,
        filtros.porPagina,
        (filtros.pagina - 1) * filtros.porPagina,
      ],
    );
    return {
      total: Number(conteo?.total ?? 0),
      estudiantes: filas.map(
        (fila: Record<string, unknown>): ResumenEstudiante => ({
          uuid: fila.uuid as string,
          numeroDocumento: fila.numero_documento as string,
          nombres: fila.nombres as string,
          apellidos: fila.apellidos as string,
          estado: fila.estado as EstadoEstudiante,
          grupo: (fila.grupo as string) ?? null,
          acudienteTitular: (fila.titular as string) ?? null,
        }),
      ),
    };
  }

  /**
   * HU01-E3: cambia la ficha y deja constancia de quién y cuándo.
   * `actualizado_en` lo pone la columna con ON UPDATE. `false` si no existe.
   */
  async actualizar(
    uuid: string,
    datos: {
      nombres?: string;
      apellidos?: string;
      fechaNacimiento?: string;
      grupoId?: number;
      estado?: EstadoEstudiante;
    },
    actorId: string,
  ): Promise<boolean> {
    const columnas: string[] = ['actualizado_por = ?'];
    const valores: unknown[] = [actorId];
    const asignar = (columna: string, valor: unknown) => {
      if (valor !== undefined) {
        columnas.push(`${columna} = ?`);
        valores.push(valor);
      }
    };
    asignar('nombres', datos.nombres);
    asignar('apellidos', datos.apellidos);
    asignar('fecha_nacimiento', datos.fechaNacimiento);
    asignar('grupo_id', datos.grupoId);
    asignar('estado', datos.estado);

    const resultado = await this.db.query(
      `UPDATE estudiante SET ${columnas.join(', ')} WHERE uuid = ?`,
      [...valores, uuid],
    );
    return filasAfectadas(resultado) > 0;
  }

  /** Marca quién tocó la ficha, cuando el cambio fue en un acudiente (HU01-E3). */
  async marcarActualizada(
    estudianteId: string,
    actorId: string,
  ): Promise<void> {
    await this.db.query(
      'UPDATE estudiante SET actualizado_por = ? WHERE id = ?',
      [actorId, estudianteId],
    );
  }

  async buscarVinculo(
    estudianteUuid: string,
    acudienteUuid: string,
  ): Promise<VinculoLocalizado | null> {
    const [fila] = await this.db.query(
      `SELECT v.estudiante_id, v.usuario_id, v.titular, v.estado
         FROM acudiente_estudiante v
         JOIN estudiante e ON e.id = v.estudiante_id
         JOIN usuario    u ON u.id = v.usuario_id
        WHERE e.uuid = ? AND u.uuid = ?`,
      [estudianteUuid, acudienteUuid],
    );
    return fila
      ? {
          estudianteId: String(fila.estudiante_id),
          usuarioId: String(fila.usuario_id),
          titular: Boolean(fila.titular),
          estado: fila.estado,
        }
      : null;
  }

  /** HU01-E3: parentesco y estado del vínculo con ese estudiante. */
  async actualizarVinculo(
    estudianteId: string,
    usuarioId: string,
    datos: { parentesco?: Parentesco; estado?: EstadoVinculo },
  ): Promise<void> {
    const columnas: string[] = [];
    const valores: unknown[] = [];
    if (datos.parentesco !== undefined) {
      columnas.push('parentesco = ?');
      valores.push(datos.parentesco);
    }
    if (datos.estado !== undefined) {
      columnas.push('estado = ?');
      valores.push(datos.estado);
    }
    if (columnas.length === 0) {
      return;
    }
    await this.db.query(
      `UPDATE acudiente_estudiante SET ${columnas.join(', ')}
        WHERE estudiante_id = ? AND usuario_id = ?`,
      [...valores, estudianteId, usuarioId],
    );
  }
}
