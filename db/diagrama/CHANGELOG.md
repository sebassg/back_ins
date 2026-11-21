# Historial del modelo de datos

Cada implementación que toque la base de datos agrega aquí una entrada,
actualiza `er.mmd` y regenera `er.png` (ver `README.md` de esta carpeta). Los
scripts son forward-only: no se edita uno ya aplicado.

## v1 — HU07 (inicio de sesión del acudiente) + HU12 (inicio de sesión del personal por rol)

Script: `db/migrations/001_hu07_hu12_autenticacion.sql`

**Siete tablas**, separadas por responsabilidad:

| Tabla | Para qué |
|---|---|
| `usuario` | Quién es la persona: documento, nombre, contacto, rol y estado |
| `credencial` | 1:1 con usuario. Lo que cambia al entrar: hash, intentos fallidos, bloqueo, último ingreso |
| `sesion` | Una fila por inicio de sesión. Es la familia de refresh tokens y es lo que se revoca (HU12-E3) |
| `refresh_token` | Los tokens que rotan dentro de una sesión (contrato `RefreshTokenStore`) |
| `token_correo` | Enlaces de activación y de recuperación (contrato `EmailTokenStore`, HU07-E3) |
| `intento_login` | Bitácora de intentos de ingreso; regla de los cinco intentos (HU07-E2) |
| `auditoria` | Bitácora institucional inmutable (RNF-04, insumo de HU10) |

**Otros objetos**: cuatro triggers que impiden `UPDATE` y `DELETE` sobre las dos
bitácoras (RNF-04).

**Decisiones de modelado que conviene no deshacer sin discutirlo**

- Los catálogos fijos (tipo de documento, rol) son **ENUM, no tablas**: son datos
  técnicos del sistema, no información que la institución administre.
- `usuario` guarda solo información de la persona. Todo lo que cambia al iniciar
  sesión vive en `credencial`.
- No existe una columna "debe cambiar la contraseña": es deducible del estado.
  Toda cuenta se activa por enlace, así que el usuario final nunca recibe una
  contraseña ajena que deba cambiar después.
- Se revoca la **sesión**, no los tokens: un refresh que llegue después de
  revocar nace apuntando a una sesión revocada, así que tampoco sirve.

## Posibles cambios futuros (opciones, no deudas)

- **Panel granular de permisos.** Si la institución necesita administrar permisos
  por cargo (por ejemplo, que solo rectoría exporte el reporte oficial de HU10-E2,
  o separar coordinación de secretaría), el camino es agregar `rol`, `permiso` y
  `rol_permiso` en una migración posterior y migrar el ENUM `usuario.rol` a una
  llave foránea. Hoy serían tablas sin requisito que las pida.
- **Varios roles por persona.** Si aparece el caso de una docente que además es
  acudiente de su propio hijo, se agrega `usuario_rol` y el ENUM pasa a ser el
  rol principal.

## Pendiente en las próximas HU

- **HU01**: `estudiante`, `grupo`, `acudiente_estudiante`, `autorizacion_tratamiento_datos`.
- **HU02/HU03**: `pase_qr`, `autorizacion_tercero`, `tercero`.
- **HU04**: `entrega` (bitácora de entregas).
- **HU05/HU06**: `restriccion_custodia`, `soporte_legal`, `incidente_seguridad`.
- **HU08**: `excepcion_retiro`. **HU09**: `excusa_medica`. **HU11**: `cambio_hora_salida`.
