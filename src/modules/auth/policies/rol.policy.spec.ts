import { RolPolicy } from './rol.policy.js';

describe('RolPolicy (HU12-E2)', () => {
  const politica = new RolPolicy();
  const acudiente = { uuid: 'a', rol: 'ACUDIENTE' as const };
  const docente = { uuid: 'd', rol: 'DOCENTE' as const };
  const administrativo = { uuid: 'x', rol: 'ADMINISTRATIVO' as const };

  it('niega a quien no tiene sesión', () => {
    expect(politica.autenticado(null)).toBe(false);
    expect(politica.administrativo(null)).toBe(false);
  });

  it('cada sección es solo de su rol', () => {
    expect(politica.administrativo(administrativo)).toBe(true);
    expect(politica.administrativo(docente)).toBe(false);
    expect(politica.administrativo(acudiente)).toBe(false);

    expect(politica.personal(docente)).toBe(true);
    expect(politica.personal(administrativo)).toBe(true);
    expect(politica.personal(acudiente)).toBe(false);

    expect(politica.acudiente(acudiente)).toBe(true);
    expect(politica.acudiente(docente)).toBe(false);
  });
});
