import { depurarDetalle } from './auditoria.service.js';

describe('depurarDetalle (RNF-03)', () => {
  it('quita contraseñas, tokens y hashes en cualquier nivel', () => {
    expect(
      depurarDetalle({
        intentos: 5,
        contrasena: 'x',
        refreshToken: 'y',
        anidado: {
          hash_contrasena: 'z',
          motivo: 'ok',
          lista: [{ token: 't', a: 1 }],
        },
      }),
    ).toEqual({ intentos: 5, anidado: { motivo: 'ok', lista: [{ a: 1 }] } });
  });
});
