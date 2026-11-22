import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { CuentaParaLogin } from '../usuarios/usuario.types.js';
import { AuthService, MENSAJE_CREDENCIALES_INVALIDAS } from './auth.service.js';

const AHORA = new Date('2026-03-02T14:00:00Z');

function cuenta(cambios: Partial<CuentaParaLogin> = {}): CuentaParaLogin {
  return {
    id: '7',
    uuid: '6f1c1b2e-5d7a-4c1e-9b1a-2a3b4c5d6e7f',
    rol: 'ACUDIENTE',
    estado: 'ACTIVO',
    nombres: 'Ana',
    apellidos: 'Pérez',
    hashContrasena: '$scrypt$hash',
    bloqueadoHasta: null,
    ...cambios,
  };
}

function crear({
  encontrada = cuenta() as CuentaParaLogin | null,
  valida = true,
} = {}) {
  const usuarios = {
    buscarParaLogin: vi.fn().mockResolvedValue(encontrada),
    buscarEstado: vi.fn(),
    buscarCorreoPorDocumento: vi.fn(),
  };
  const credenciales = {
    sumarIntentoFallido: vi.fn(),
    bloquear: vi.fn(),
    registrarIngreso: vi.fn(),
    activar: vi.fn(),
  };
  const auditoria = { registrar: vi.fn(), registrarIntento: vi.fn() };
  const hasher = {
    verify: vi.fn().mockResolvedValue(valida),
    hash: vi.fn().mockResolvedValue('h'),
  };
  const tokens = {
    issue: vi
      .fn()
      .mockResolvedValue({
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
      }),
    refresh: vi.fn(),
    revoke: vi.fn(),
  };
  const recuperacion = { request: vi.fn(), reset: vi.fn() };
  const activacion = { send: vi.fn(), verify: vi.fn() };
  const eventos = { events$: new Subject() };
  const config = {
    get: (clave: string) =>
      ({ MAX_INTENTOS_LOGIN: 5, BLOQUEO_MINUTOS: 15 })[clave],
  };
  const servicio = new AuthService(
    usuarios as any,
    credenciales as any,
    auditoria as any,
    hasher as any,
    tokens as any,
    recuperacion as any,
    activacion as any,
    eventos as any,
    config as any,
  );
  return {
    servicio,
    usuarios,
    credenciales,
    auditoria,
    hasher,
    tokens,
    recuperacion,
    activacion,
  };
}

/** El error del intento, para comparar mensaje y tipo. */
async function errorDe(promesa: Promise<unknown>) {
  try {
    await promesa;
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba un error');
}

describe('AuthService.iniciarSesion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });
  afterEach(() => vi.useRealTimers());

  it('emite tokens con el rol y registra el ingreso', async () => {
    const { servicio, tokens, credenciales, auditoria } = crear();

    const sesion = await servicio.iniciarSesion('1001', 'secreta', {
      ip: '10.0.0.1',
    });

    expect(sesion.usuario.rol).toBe('ACUDIENTE');
    expect(tokens.issue).toHaveBeenCalledWith(cuenta().uuid, {
      claims: { rol: 'ACUDIENTE', amr: ['pwd'] },
      method: 'password',
    });
    expect(credenciales.registrarIngreso).toHaveBeenCalledWith('7', AHORA);
    expect(auditoria.registrarIntento).toHaveBeenCalledWith(
      expect.objectContaining({ exitoso: true, usuarioId: '7' }),
    );
  });

  it('HU07-E2: responde el mismo mensaje genérico sea cual sea la causa', async () => {
    const casos = [
      crear({ encontrada: null }),
      crear({ valida: false }),
      crear({ encontrada: cuenta({ estado: 'INACTIVO' }) }),
      crear({
        encontrada: cuenta({
          estado: 'PENDIENTE_ACTIVACION',
          hashContrasena: null,
        }),
      }),
      crear({
        encontrada: cuenta({
          bloqueadoHasta: new Date(AHORA.getTime() + 60_000),
        }),
      }),
    ];
    for (const { servicio, credenciales } of casos) {
      credenciales.sumarIntentoFallido.mockResolvedValue(1);
      const error = await errorDe(servicio.iniciarSesion('1001', 'otra'));
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe(MENSAJE_CREDENCIALES_INVALIDAS);
    }
  });

  it('verifica la contraseña aunque el documento no exista (mismo tiempo de respuesta)', async () => {
    const { servicio, hasher, auditoria } = crear({ encontrada: null });

    await errorDe(servicio.iniciarSesion('9999', 'x'));

    expect(hasher.verify).toHaveBeenCalledWith('x', undefined);
    expect(auditoria.registrarIntento).toHaveBeenCalledWith(
      expect.objectContaining({
        usuarioId: null,
        motivoFallo: 'USUARIO_INEXISTENTE',
      }),
    );
  });

  it('HU07-E2: al quinto fallo bloquea 15 minutos y lo audita', async () => {
    const { servicio, credenciales, auditoria } = crear({ valida: false });
    credenciales.sumarIntentoFallido.mockResolvedValue(5);

    await errorDe(servicio.iniciarSesion('1001', 'mala'));

    expect(credenciales.bloquear).toHaveBeenCalledWith(
      '7',
      new Date(AHORA.getTime() + 15 * 60_000),
    );
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ accion: 'CUENTA_BLOQUEADA' }),
    );
  });

  it('antes del quinto fallo no bloquea', async () => {
    const { servicio, credenciales, auditoria } = crear({ valida: false });
    credenciales.sumarIntentoFallido.mockResolvedValue(4);

    await errorDe(servicio.iniciarSesion('1001', 'mala'));

    expect(credenciales.bloquear).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('una cuenta bloqueada no entra ni con la contraseña correcta, y no suma intentos', async () => {
    const { servicio, tokens, credenciales } = crear({
      encontrada: cuenta({ bloqueadoHasta: new Date(AHORA.getTime() + 1) }),
    });

    await errorDe(servicio.iniciarSesion('1001', 'secreta'));

    expect(tokens.issue).not.toHaveBeenCalled();
    expect(credenciales.sumarIntentoFallido).not.toHaveBeenCalled();
  });

  it('pasados los 15 minutos el bloqueo ya no aplica', async () => {
    const { servicio, tokens } = crear({
      encontrada: cuenta({ bloqueadoHasta: new Date(AHORA.getTime() - 1) }),
    });

    await servicio.iniciarSesion('1001', 'secreta');

    expect(tokens.issue).toHaveBeenCalled();
  });
});

describe('AuthService.renovar', () => {
  it('relee el rol y rechaza la renovación de una cuenta desactivada', async () => {
    const { servicio, tokens, usuarios } = crear();
    tokens.refresh.mockImplementation(async (_token: string, { claims }: any) =>
      claims({ amr: ['pwd'], rol: 'ACUDIENTE' }, 'uuid-1'),
    );

    usuarios.buscarEstado.mockResolvedValue({
      id: '1',
      rol: 'DOCENTE',
      estado: 'ACTIVO',
    });
    await expect(servicio.renovar('r')).resolves.toEqual({
      amr: ['pwd'],
      rol: 'DOCENTE',
    });

    usuarios.buscarEstado.mockResolvedValue({
      id: '1',
      rol: 'DOCENTE',
      estado: 'INACTIVO',
    });
    await expect(servicio.renovar('r')).rejects.toMatchObject({
      reason: 'invalid',
    });
  });
});

describe('AuthService: enlaces', () => {
  it('HU07-E3: un enlace inválido, usado o vencido responde 400', async () => {
    const { servicio, recuperacion } = crear();
    recuperacion.reset.mockResolvedValue(null);

    await expect(
      servicio.restablecerContrasena('t', 'nueva-clave'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('la recuperación solo se pide para el correo registrado de una cuenta activa', async () => {
    const { servicio, usuarios, recuperacion } = crear();
    usuarios.buscarCorreoPorDocumento.mockResolvedValue({
      uuid: 'u',
      correo: 'ana@x.co',
    });

    servicio.solicitarRecuperacion('1001');
    await vi.waitFor(() =>
      expect(recuperacion.request).toHaveBeenCalledWith('ana@x.co'),
    );
    expect(usuarios.buscarCorreoPorDocumento).toHaveBeenCalledWith(
      '1001',
      'ACTIVO',
    );
  });

  it('activar calcula el hash antes de gastar el enlace y exige una cuenta pendiente', async () => {
    const { servicio, hasher, activacion, credenciales } = crear();
    activacion.verify.mockResolvedValue({ userId: 'u', email: 'a@x.co' });
    credenciales.activar.mockResolvedValue(false);

    await expect(
      servicio.activarCuenta('t', 'nueva-clave'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(hasher.hash.mock.invocationCallOrder[0]).toBeLessThan(
      activacion.verify.mock.invocationCallOrder[0],
    );
  });
});
