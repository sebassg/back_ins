import { z } from 'zod';
import { TIPOS_DOCUMENTO } from '../../usuarios/usuario.types.js';
import { PARENTESCOS } from '../estudiante.types.js';

/**
 * HU01-E2 pide impedir el guardado y «resaltar los campos faltantes»: cada
 * mensaje nombra el campo, porque es lo que la aplicación muestra junto a él.
 */
const numeroDocumento = z
  .string()
  .trim()
  .min(3, 'Ingrese el número de documento')
  .max(20, 'El número de documento no puede superar 20 caracteres');

const nombres = z
  .string()
  .trim()
  .min(2, 'Ingrese los nombres')
  .max(100, 'Los nombres no pueden superar 100 caracteres');

const apellidos = z
  .string()
  .trim()
  .min(2, 'Ingrese los apellidos')
  .max(100, 'Los apellidos no pueden superar 100 caracteres');

// El correo se guarda en collation binaria, así que la aplicación lo normaliza
// a minúsculas: de lo contrario la misma dirección entraría dos veces.
const correo = z
  .email('Ingrese un correo electrónico válido')
  .max(150)
  .transform((valor) => valor.trim().toLowerCase());

const telefono = z
  .string()
  .trim()
  .max(20, 'El teléfono no puede superar 20 caracteres')
  .optional();

const tipoDocumento = z.enum(TIPOS_DOCUMENTO);

/** `YYYY-MM-DD`: la columna es DATE, sin hora ni zona. */
const fechaNacimiento = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
  .optional();

const identificadorGrupo = z.coerce
  .number()
  .int()
  .positive('Seleccione el grupo del estudiante');

export const uuidEstudiante = z.uuid({
  message: 'Identificador de estudiante inválido',
});

export const uuidAcudiente = z.uuid({
  message: 'Identificador de acudiente inválido',
});

/**
 * HU01-E1: un solo guardado con el menor, su acudiente titular y la
 * autorización de tratamiento de datos.
 *
 * `versionAviso` no se recibe del cliente: la estampa el servidor desde
 * VERSION_AVISO_PRIVACIDAD. Una constancia legal no puede depender de lo que
 * diga quien envía el formulario.
 */
export const registrarEstudianteSchema = z.object({
  tipoDocumento: tipoDocumento.default('RC'),
  numeroDocumento,
  nombres,
  apellidos,
  fechaNacimiento,
  grupoId: identificadorGrupo,
  acudiente: z.object({
    tipoDocumento: tipoDocumento.default('CC'),
    numeroDocumento,
    nombres,
    apellidos,
    correo,
    telefono,
    parentesco: z.enum(PARENTESCOS),
  }),
  // Debe venir en true: es el consentimiento informado del menor y sin él no
  // hay registro (Ley 1581 de 2012).
  autorizacionTratamientoDatos: z.literal(true, {
    message: 'Debe registrar la autorización de tratamiento de datos del menor',
  }),
});
export type RegistrarEstudianteDto = z.infer<typeof registrarEstudianteSchema>;

/** HU01-E3: la ficha del estudiante. Solo cambia lo que llega. */
export const actualizarEstudianteSchema = z
  .object({
    nombres: nombres.optional(),
    apellidos: apellidos.optional(),
    fechaNacimiento,
    grupoId: identificadorGrupo.optional(),
    estado: z.enum(['ACTIVO', 'RETIRADO']).optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Indique al menos un dato que cambiar',
  });
export type ActualizarEstudianteDto = z.infer<
  typeof actualizarEstudianteSchema
>;

/** HU01-E3: datos de contacto del acudiente y estado de su vínculo. */
export const actualizarAcudienteSchema = z
  .object({
    correo: correo.optional(),
    // `null` borra el teléfono registrado; omitirlo lo deja como está.
    telefono: telefono.or(z.null()),
    parentesco: z.enum(PARENTESCOS).optional(),
    estado: z.enum(['ACTIVO', 'INACTIVO']).optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Indique al menos un dato que cambiar',
  });
export type ActualizarAcudienteDto = z.infer<typeof actualizarAcudienteSchema>;

/** HU01-E3: «busca al estudiante por nombre o documento». */
export const buscarEstudiantesSchema = z.object({
  buscar: z.string().trim().max(100).optional(),
  grupoId: identificadorGrupo.optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});
export type BuscarEstudiantesDto = z.infer<typeof buscarEstudiantesSchema>;
