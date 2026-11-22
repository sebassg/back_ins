import { validarEnv } from './env.validation.js';

/** Un entorno mínimo válido, al que cada prueba le cambia una sola cosa. */
const entornoBase = {
  DB_HOST: '127.0.0.1',
  DB_NAME: 'retiro_seguro',
  DB_USER: 'retiro_app',
  DB_PASSWORD: 'retiro_app',
  JWT_SECRET: 'x'.repeat(48),
  JWT_ISSUER: 'https://api.retiroseguro.local',
  JWT_AUDIENCE: 'app-retiro-seguro',
  URL_APP: 'http://localhost:5173',
  URL_RESTABLECER_CONTRASENA: 'http://localhost:5173/restablecer-contrasena',
};

describe('validarEnv', () => {
  it('aplica los valores por omisión de las reglas de HU07', () => {
    const env = validarEnv({ ...entornoBase });

    expect(env.MAX_INTENTOS_LOGIN).toBe(5);
    expect(env.BLOQUEO_MINUTOS).toBe(15);
    expect(env.TOKEN_RECUPERACION_TTL).toBe('30m');
    expect(env.ACCESS_TOKEN_TTL).toBe('15m');
  });

  it('convierte los números que vienen como texto del .env', () => {
    const env = validarEnv({ ...entornoBase, PORT: '4000', DB_PORT: '3307' });

    expect(env.PORT).toBe(4000);
    expect(env.DB_PORT).toBe(3307);
  });

  it('rechaza un JWT_SECRET demasiado corto', () => {
    expect(() => validarEnv({ ...entornoBase, JWT_SECRET: 'corto' })).toThrow(
      /JWT_SECRET/,
    );
  });

  it('rechaza una duración mal escrita', () => {
    expect(() =>
      validarEnv({ ...entornoBase, TOKEN_RECUPERACION_TTL: 'media hora' }),
    ).toThrow(/TOKEN_RECUPERACION_TTL/);
  });

  it('exige las variables sin las que la aplicación no puede arrancar', () => {
    const { DB_HOST: _omitido, ...sinHost } = entornoBase;

    expect(() => validarEnv(sinHost)).toThrow(/DB_HOST/);
  });
});
