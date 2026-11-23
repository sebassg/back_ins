import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { UsuarioAutenticado } from '../usuarios/usuario.types.js';
import type { CuentaExistente } from '../usuarios/usuarios.repository.js';
import type { RegistrarEstudianteDto } from './dto/estudiante.dto.js';
import type { FichaEstudiante } from './estudiante.types.js';
import { ConflictoDeRegistro } from './estudiantes.repository.js';
import { EstudiantesService } from './estudiantes.service.js';

const ADMIN: UsuarioAutenticado = {
  uuid: '11111111-1111-4111-8111-111111111111',
  rol: 'ADMINISTRATIVO',
};
const UUID_ESTUDIANTE = '22222222-2222-4222-8222-222222222222';
const UUID_ACUDIENTE = '33333333-3333-4333-8333-333333333333';

/** Los datos del menor, que NUNCA deben aparecer en la bitácora (RNF-03). */
const MENOR = {
  nombres: 'Sofía Valentina',
  apellidos: 'Restrepo Gómez',
  numeroDocumento: '1098765432',
};

function dto(cambios: Partial<RegistrarEstudianteDto> = {}) {
  return {
    tipoDocumento: 'RC',
    ...MENOR,
    grupoId: 1,
    acudiente: {
      tipoDocumento: 'CC',
      numeroDocumento: '1001',
      nombres: 'Ana María',
      apellidos: 'Gómez Díaz',
      correo: 'ana@correo.com',
      parentesco: 'MADRE',
    },
    autorizacionTratamientoDatos: true,
    ...cambios,
  } as RegistrarEstudianteDto;
}

function cuenta(cambios: Partial<CuentaExistente> = {}): CuentaExistente {
  return {
    id: '9',
    uuid: UUID_ACUDIENTE,
    rol: 'ACUDIENTE',
    estado: 'PENDIENTE_ACTIVACION',
    tipoDocumento: 'CC',
    nombres: 'Ana María',
    apellidos: 'Gómez Díaz',
    correo: 'ana@correo.com',
    telefono: null,
    ...cambios,
  };
}

function crear({
  acudienteExistente = null as CuentaExistente | null,
  correoOcupadoPor = null as string | null,
  grupoExiste = true,
  documentoRegistrado = false,
} = {}) {
  const ficha = { uuid: UUID_ESTUDIANTE } as FichaEstudiante;
  const estudiantes = {
    grupoExiste: vi.fn().mockResolvedValue(grupoExiste),
    documentoRegistrado: vi.fn().mockResolvedValue(documentoRegistrado),
    registrarFicha: vi.fn().mockResolvedValue({
      estudianteId: '5',
      estudianteUuid: UUID_ESTUDIANTE,
      acudienteId: '9',
      acudienteUuid: acudienteExistente ? null : UUID_ACUDIENTE,
    }),
    ficha: vi.fn().mockResolvedValue(ficha),
    buscar: vi.fn(),
    actualizar: vi.fn().mockResolvedValue(true),
    buscarVinculo: vi.fn(),
    actualizarVinculo: vi.fn(),
    marcarActualizada: vi.fn(),
    listarGrupos: vi.fn(),
  };
  const usuarios = {
    buscarEstado: vi
      .fn()
      .mockResolvedValue({ id: '1', rol: 'ADMINISTRATIVO', estado: 'ACTIVO' }),
    buscarPorDocumento: vi.fn().mockResolvedValue(acudienteExistente),
    duenoDelCorreo: vi.fn().mockResolvedValue(correoOcupadoPor),
    actualizarContacto: vi.fn(),
  };
  const auditoria = { registrar: vi.fn(), registrarIntento: vi.fn() };
  const activacion = { send: vi.fn().mockResolvedValue({ expiresAt: null }) };
  const config = {
    get: (clave: string) => ({ VERSION_AVISO_PRIVACIDAD: '2026-11' })[clave],
  };
  const servicio = new EstudiantesService(
    estudiantes as never,
    usuarios as never,
    auditoria as never,
    activacion as never,
    config as never,
  );
  return { servicio, estudiantes, usuarios, auditoria, activacion, ficha };
}

/** El error de la operación, para comparar tipo y cuerpo de la respuesta. */
async function errorDe(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (error) {
    return error as { getResponse(): { message: string; campo?: string } };
  }
  throw new Error('se esperaba un error');
}

describe('EstudiantesService.registrar (HU01-E1)', () => {
  it('registra la ficha, abre la cuenta del acudiente y le envía la activación', async () => {
    const { servicio, estudiantes, activacion } = crear();

    const registro = await servicio.registrar(dto(), ADMIN, '10.0.0.1');

    expect(registro.cuentaAcudiente).toBe('CREADA');
    expect(estudiantes.registrarFicha).toHaveBeenCalledWith(
      expect.objectContaining({
        parentesco: 'MADRE',
        versionAviso: '2026-11',
        actorId: '1',
        acudiente: {
          nuevo: expect.objectContaining({ correo: 'ana@correo.com' }),
        },
      }),
    );
    expect(activacion.send).toHaveBeenCalledWith({
      id: UUID_ACUDIENTE,
      email: 'ana@correo.com',
    });
  });

  it('reutiliza la cuenta del acudiente que ya tiene otro hijo y no reenvía la activación', async () => {
    const { servicio, estudiantes, activacion } = crear({
      acudienteExistente: cuenta(),
    });

    const registro = await servicio.registrar(dto(), ADMIN);

    expect(registro.cuentaAcudiente).toBe('REUTILIZADA');
    expect(estudiantes.registrarFicha).toHaveBeenCalledWith(
      expect.objectContaining({ acudiente: { existente: '9' } }),
    );
    expect(activacion.send).not.toHaveBeenCalled();
  });

  it('RNF-03: la bitácora no registra ningún dato del menor', async () => {
    const { servicio, auditoria } = crear();

    await servicio.registrar(dto(), ADMIN);

    const escrito = JSON.stringify(auditoria.registrar.mock.calls);
    for (const dato of Object.values(MENOR)) {
      expect(escrito).not.toContain(dato);
    }
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'ESTUDIANTE_REGISTRADO',
        entidadId: UUID_ESTUDIANTE,
      }),
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'USUARIO_CREADO' }),
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'AUTORIZACION_DATOS_REGISTRADA' }),
    );
  });
});

describe('EstudiantesService.registrar (HU01-E2)', () => {
  it('rechaza el documento de un estudiante ya registrado señalando el campo', async () => {
    const { servicio, estudiantes } = crear({ documentoRegistrado: true });

    const error = await errorDe(servicio.registrar(dto(), ADMIN));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().campo).toBe('numeroDocumento');
    expect(estudiantes.registrarFicha).not.toHaveBeenCalled();
  });

  it('rechaza el documento de un acudiente registrado con datos diferentes', async () => {
    const { servicio } = crear({
      acudienteExistente: cuenta({ nombres: 'Otra Persona' }),
    });

    const error = await errorDe(servicio.registrar(dto(), ADMIN));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().campo).toBe('acudiente.numeroDocumento');
  });

  it('no vincula como acudiente el documento de un funcionario', async () => {
    const { servicio } = crear({
      acudienteExistente: cuenta({ rol: 'DOCENTE' }),
    });

    const error = await errorDe(servicio.registrar(dto(), ADMIN));

    expect(error.getResponse().message).toContain('personal institucional');
  });

  it('no reutiliza una cuenta desactivada', async () => {
    const { servicio } = crear({
      acudienteExistente: cuenta({ estado: 'INACTIVO' }),
    });

    const error = await errorDe(servicio.registrar(dto(), ADMIN));

    expect(error.getResponse().message).toContain('desactivada');
  });

  it('rechaza un correo que ya usa otra cuenta', async () => {
    const { servicio } = crear({ correoOcupadoPor: 'otro-uuid' });

    const error = await errorDe(servicio.registrar(dto(), ADMIN));

    expect(error.getResponse().campo).toBe('acudiente.correo');
  });

  it('rechaza un grupo que no existe', async () => {
    const { servicio } = crear({ grupoExiste: false });

    const error = await errorDe(servicio.registrar(dto(), ADMIN));

    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse().campo).toBe('grupoId');
  });

  it('traduce el choque de la llave única a un conflicto con su campo', async () => {
    const { servicio, estudiantes } = crear();
    estudiantes.registrarFicha.mockRejectedValue(
      new ConflictoDeRegistro('numeroDocumento', 'Ya existe'),
    );

    const error = await errorDe(servicio.registrar(dto(), ADMIN));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse().campo).toBe('numeroDocumento');
  });
});

describe('EstudiantesService (HU01-E3)', () => {
  it('deja constancia de quién actualizó la ficha', async () => {
    const { servicio, estudiantes, auditoria } = crear();

    await servicio.actualizar(
      UUID_ESTUDIANTE,
      { grupoId: 2 },
      ADMIN,
      '10.0.0.1',
    );

    expect(estudiantes.actualizar).toHaveBeenCalledWith(
      UUID_ESTUDIANTE,
      { grupoId: 2 },
      '1',
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'ESTUDIANTE_ACTUALIZADO',
        detalle: { camposModificados: ['grupoId'] },
      }),
    );
  });

  it('un estudiante que no existe es 404', async () => {
    const { servicio, estudiantes } = crear();
    estudiantes.actualizar.mockResolvedValue(false);

    const error = await errorDe(
      servicio.actualizar(UUID_ESTUDIANTE, { grupoId: 2 }, ADMIN),
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });

  it('cambiar el correo de una cuenta pendiente reenvía el enlace de activación', async () => {
    const { servicio, estudiantes, usuarios, activacion } = crear();
    estudiantes.buscarVinculo.mockResolvedValue({
      estudianteId: '5',
      usuarioId: '9',
      titular: true,
      estado: 'ACTIVO',
    });
    // El servicio consulta dos cuentas: la del funcionario que actúa y la del
    // acudiente, para saber si su cuenta sigue pendiente de activación.
    usuarios.buscarEstado.mockImplementation((uuid: string) =>
      Promise.resolve(
        uuid === ADMIN.uuid
          ? { id: '1', rol: 'ADMINISTRATIVO', estado: 'ACTIVO' }
          : { id: '9', rol: 'ACUDIENTE', estado: 'PENDIENTE_ACTIVACION' },
      ),
    );

    await servicio.actualizarAcudiente(
      UUID_ESTUDIANTE,
      UUID_ACUDIENTE,
      { correo: 'nuevo@correo.com' },
      ADMIN,
    );

    expect(usuarios.actualizarContacto).toHaveBeenCalledWith('9', {
      correo: 'nuevo@correo.com',
      telefono: undefined,
    });
    expect(activacion.send).toHaveBeenCalledWith({
      id: UUID_ACUDIENTE,
      email: 'nuevo@correo.com',
    });
    expect(estudiantes.marcarActualizada).toHaveBeenCalledWith('5', '1');
  });

  it('un acudiente que no está vinculado con ese estudiante es 404', async () => {
    const { servicio, estudiantes } = crear();
    estudiantes.buscarVinculo.mockResolvedValue(null);

    const error = await errorDe(
      servicio.actualizarAcudiente(
        UUID_ESTUDIANTE,
        UUID_ACUDIENTE,
        { telefono: '3001234567' },
        ADMIN,
      ),
    );

    expect(error).toBeInstanceOf(NotFoundException);
  });
});
