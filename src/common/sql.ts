/**
 * Filas afectadas por un INSERT, UPDATE o DELETE ejecutado con
 * `DataSource.query()` o `EntityManager.query()`. Con MariaDB el driver
 * devuelve un `ResultSetHeader`; las escrituras condicionales de los stores
 * dependen de este número para saber si fueron ellas las que escribieron.
 */
export function filasAfectadas(resultado: unknown): number {
  if (
    resultado &&
    typeof resultado === 'object' &&
    'affectedRows' in resultado
  ) {
    return Number((resultado as { affectedRows: unknown }).affectedRows);
  }
  throw new Error('La consulta no devolvió el número de filas afectadas');
}

/** Un DATETIME(3) leído del driver como `Date` (la conexión está en UTC). */
export function fecha(valor: unknown): Date {
  return valor instanceof Date ? valor : new Date(String(valor));
}

/** Una columna JSON de MariaDB (alias de LONGTEXT) llega como texto. */
export function json<T>(valor: unknown): T | undefined {
  if (valor === null || valor === undefined) {
    return undefined;
  }
  return (typeof valor === 'string' ? JSON.parse(valor) : valor) as T;
}

/**
 * `id` que acaba de asignar un INSERT con AUTO_INCREMENT. Se devuelve como
 * texto porque las llaves son BIGINT: fuera del rango seguro de un number.
 */
export function idInsertado(resultado: unknown): string {
  if (resultado && typeof resultado === 'object' && 'insertId' in resultado) {
    return String((resultado as { insertId: unknown }).insertId);
  }
  throw new Error('La consulta no devolvió el id insertado');
}
