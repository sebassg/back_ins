import type {
  EstadoUsuario,
  TipoDocumento,
} from '../usuarios/usuario.types.js';

/** ENUM `acudiente_estudiante.parentesco`. */
export const PARENTESCOS = [
  'MADRE',
  'PADRE',
  'ABUELO',
  'TIO',
  'HERMANO',
  'TUTOR_LEGAL',
  'OTRO',
] as const;
export type Parentesco = (typeof PARENTESCOS)[number];

/** ENUM `grupo.jornada`. */
export const JORNADAS = ['MANANA', 'TARDE', 'UNICA'] as const;
export type Jornada = (typeof JORNADAS)[number];

/** ENUM `estudiante.estado`. No se borra una ficha: se marca RETIRADO. */
export type EstadoEstudiante = 'ACTIVO' | 'RETIRADO';

/** ENUM `acudiente_estudiante.estado`: del vínculo, no de la cuenta. */
export type EstadoVinculo = 'ACTIVO' | 'INACTIVO';

export interface Grupo {
  id: string;
  nombre: string;
  jornada: Jornada;
  /** `HH:MM`, la hora de salida ordinaria del grupo. */
  horaSalida: string;
}

/** Un adulto responsable del menor, con su vínculo y el estado de su cuenta. */
export interface AcudienteDeEstudiante {
  uuid: string;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  correo: string | null;
  telefono: string | null;
  parentesco: Parentesco;
  titular: boolean;
  /** Del vínculo con este estudiante. */
  estado: EstadoVinculo;
  /** De la cuenta: PENDIENTE_ACTIVACION mientras no haya abierto el enlace. */
  estadoCuenta: EstadoUsuario;
}

/** La constancia de la Ley 1581 de 2012 vigente para el estudiante. */
export interface AutorizacionDatos {
  otorgadoEn: Date;
  otorgadoPor: string;
  versionAviso: string;
  revocadoEn: Date | null;
}

/** La ficha completa que HU01-E3 muestra al buscar un estudiante. */
export interface FichaEstudiante {
  uuid: string;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string | null;
  estado: EstadoEstudiante;
  grupo: Grupo | null;
  acudientes: AcudienteDeEstudiante[];
  autorizacionDatos: AutorizacionDatos | null;
  creadoEn: Date;
  /** HU01-E3: la fecha y el usuario del último cambio. */
  actualizadoEn: Date;
  actualizadoPor: string | null;
}

/** Una fila del listado de búsqueda (HU01-E3). */
export interface ResumenEstudiante {
  uuid: string;
  numeroDocumento: string;
  nombres: string;
  apellidos: string;
  estado: EstadoEstudiante;
  grupo: string | null;
  acudienteTitular: string | null;
}

/** Si la cuenta del acudiente se abrió ahora o ya existía (caso hermanos). */
export type ResultadoCuenta = 'CREADA' | 'REUTILIZADA';

export interface EstudianteRegistrado {
  ficha: FichaEstudiante;
  cuentaAcudiente: ResultadoCuenta;
}
