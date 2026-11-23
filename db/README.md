# Base de datos — Retiro Seguro (I.E. Esteban Ochoa, Equipo 1.1)

Motor: **MariaDB 11+**. Esta carpeta es la **única fuente de verdad del esquema**:
TypeORM nunca crea ni altera tablas (`synchronize: false`). Todo cambio de
estructura entra como un script nuevo en `migrations/`.

```
db/
├── migrations/   esquema, forward-only (001_, 002_, ...). Un script aplicado NO se edita
├── seeds/        datos indispensables: por ahora, la cuenta administrativa inicial
├── diagrama/     er.mmd (fuente), er.png / er.svg (imagen) y CHANGELOG.md (qué agregó cada HU)
└── install.sh    aplica migraciones y semillas en orden
```

## Cómo aplicarla

```bash
cp .env.example .env     # ajuste usuario y contraseña
npm run db:up            # levanta MariaDB en Docker
npm run db:install       # aplica db/migrations/* y db/seeds/* en orden
```

Sin Docker, con un MariaDB ya instalado: ajuste `DB_*` en `.env` y ejecute
`npm run db:install`. Los scripts son **idempotentes**: volver a ejecutarlos no
rompe nada ni duplica datos.

## Convenciones

- Motor InnoDB, `utf8mb4`. Fechas `DATETIME(3)` **siempre en UTC**.
- **Los catálogos fijos son ENUM, no tablas.** El tipo de documento y el rol son
  datos técnicos del sistema, no información que la institución administre: una
  tabla de dos columnas con seis filas que nadie edita solo agrega un JOIN.
- Tokens, hashes, correos y documentos en columnas con collation **binaria**
  (`utf8mb4_bin`): la comparación debe ser exacta. Un `correo` con collation
  insensible a acentos haría que `victim@exämple.com` encontrara la cuenta de
  `victim@example.com` y le mandara su enlace de recuperación.
- **Nunca se borra un usuario ni un registro de bitácora**: se cambia el estado.
- Nombres de tablas y columnas en español, igual que el backlog.

## Las once tablas

Siete son de la autenticación (migración 001) y cuatro del registro de
estudiantes (migración 002).

| Tabla | Responsabilidad |
|---|---|
| `usuario` | Quién es la persona: documento, nombre, contacto, `rol` y `estado` |
| `credencial` | 1:1 con usuario. Lo que cambia al entrar: hash, intentos fallidos, bloqueo, último ingreso |
| `sesion` | Una fila por inicio de sesión. Es lo que se revoca |
| `refresh_token` | Los tokens que rotan dentro de una sesión |
| `token_correo` | Enlaces de activación y de recuperación |
| `intento_login` | Bitácora de intentos de ingreso (HU07-E2) |
| `auditoria` | Bitácora institucional inmutable (RNF-04) |
| `grupo` | El curso de preescolar: jornada, hora de salida y docente titular |
| `estudiante` | Quién es el menor. No tiene cuenta ni credencial |
| `acudiente_estudiante` | Quién responde por el menor, con qué parentesco, y quién es el titular |
| `autorizacion_tratamiento_datos` | La constancia de la Ley 1581 de 2012 |

La división entre `usuario` y `credencial` es deliberada: `usuario` responde
*quién es*, `credencial` responde *cómo entra y qué le pasó al intentarlo*. Lo
segundo cambia en cada inicio de sesión y no tiene por qué ensuciar la ficha de
la persona.

## 1. Cómo se maneja la sesión

Un solo mecanismo para la app móvil y para el panel web: **access token JWT de
15 minutos + refresh token opaco de 30 días**.

1. **El access token es corto y sin estado.** Lleva en sus claims el `sub` (el
   `uuid` del usuario) y su rol, de modo que validar una petición no cuesta
   consultas (RNF-01: la portería responde en ≤3 s).
2. **El refresh token es opaco y rota.** Se guarda únicamente su SHA-256; cada
   token vale **una sola vez** y su sucesor pertenece a la misma `sesion`. Si
   reaparece un token ya usado, significa que dos partes lo tienen (la app y
   quien lo robó): se revoca la sesión completa y hay que volver a entrar.
3. **Una fila de `sesion` es un inicio de sesión, no una petición.** Guarda el
   dispositivo, la IP y el momento del último uso, que es lo que alimenta una
   pantalla de "dispositivos activos" y la auditoría.
4. **Revocar es una sola sentencia** (HU12-E3):

   ```sql
   UPDATE sesion
      SET revocada_en = NOW(3), motivo_revocacion = 'USUARIO_DESACTIVADO'
    WHERE usuario_id = ? AND revocada_en IS NULL;
   ```

   Se revoca la sesión y no los tokens a propósito: una renovación que llegue un
   instante después nace apuntando a una sesión ya revocada, así que tampoco
   sirve. El access token que siga vivo expira en 15 minutos como máximo, que es
   el precio de no consultar la base de datos en cada petición.

Duraciones (configurables en `.env`): access 15 min · refresh 30 d · sesión 90 d.

## 2. Cómo funcionan los roles

**Tres roles, quemados en la base de datos** como ENUM de `usuario.rol`:

| Rol | Quién es | Qué hace en el backlog |
|---|---|---|
| `ACUDIENTE` | Acudiente titular del estudiante | Genera su pase QR (HU02), autoriza terceros (HU03), envía excusas médicas (HU09) |
| `DOCENTE` | Docente a cargo de un grupo | Valida la entrega en portería (HU04), recibe alertas (HU06), notifica cambios de hora (HU11) |
| `ADMINISTRATIVO` | Secretaría, coordinación y rectoría | Gestiona estudiantes y cuentas (HU01, HU12), restricciones (HU05), excepciones (HU08) y reportes (HU10) |

Los tres cargos administrativos comparten pantallas y se diferencian en permisos,
no en funcionalidad, así que comparten rol. El control de acceso de HU12-E2 se
expresa en código, con las políticas de `@nestjs/authorization`, no en datos.

> **Si más adelante hace falta más detalle.** El día que la institución pida, por
> ejemplo, que solo rectoría exporte el reporte oficial (HU10-E2) o separar
> coordinación de secretaría, el camino es agregar `rol`, `permiso` y
> `rol_permiso` en una migración posterior y convertir el ENUM en una llave
> foránea. Se decidió no construirlo todavía porque ninguna historia del backlog
> lo pide, y unas tablas de permisos vacías de requisito solo serían un JOIN más
> en cada petición.

## 3. Cómo se registran los usuarios

HU07-E1 dice que la cuenta la **crea la institución**: no hay auto-registro. El
flujo es de provisión más activación, y es el mismo para un acudiente y para un
funcionario:

```
1. El personal administrativo crea la cuenta: tipo y número de documento,
   nombres, correo, teléfono y rol.
   → usuario.estado = 'PENDIENTE_ACTIVACION'
   → credencial.hash_contrasena = NULL
2. El sistema envía un enlace de activación al correo registrado (72 h).
   → token_correo (proposito = 'email-verification')
3. El usuario abre el enlace y define SU propia contraseña.
   → credencial.hash_contrasena = scrypt(...), usuario.estado = 'ACTIVO'
4. Ya puede iniciar sesión con su número de documento (HU07-E1).
```

Nadie —ni la secretaría ni el equipo de desarrollo— conoce la contraseña de un
acudiente en ningún momento.

**Por eso no existe una columna `debe_cambiar_contrasena`.** Esa columna hace
falta cuando alguien entrega una contraseña temporal, y aquí eso no ocurre nunca:
una cuenta sin activar se reconoce por su estado, y al activarse la contraseña ya
es la que eligió su dueño.

La activación y la recuperación usan la misma tabla y el mismo contrato
(`EmailTokenStore`) porque son el mismo problema: probar que alguien controla el correo registrado y dejarlo fijar una
contraseña. La diferencia es la vigencia (72 horas contra 30 minutos) y que al
activar no había contraseña previa. Por esa diferencia de vigencia, la
activación usa el flujo `email-verification` de `@nestjs/authentication` y la
recuperación el de `password-reset`: cada uno tiene su propio TTL.

## 4. Recuperación de contraseña (HU07-E3)

```
1. El acudiente ingresa su número de documento.
2. El sistema busca la cuenta y responde SIEMPRE lo mismo, exista o no:
   "Si el documento está registrado, enviamos un enlace al correo de la
   institución". (No se revela qué documentos existen.)
3. Envía el enlace al correo REGISTRADO en la institución —nunca a uno que se
   escriba en el formulario—, válido 30 minutos y de un solo uso.
   → token_correo.expira_en = ahora + 30 min
4. Al restablecer: se guarda el nuevo hash, se borran los demás enlaces
   pendientes y se revocan todas las sesiones del usuario.
```

La columna `huella` guarda el SHA-256 del hash de contraseña vigente al emitir el
enlace: si la contraseña cambia por cualquier vía, los enlaces enviados antes
quedan inservibles.

## 5. Bloqueo por intentos fallidos (HU07-E2)

- Cada intento se registra en `intento_login` (con `usuario_id` nulo si el
  documento no existe, para no revelar qué documentos están registrados).
- `credencial.intentos_fallidos` se incrementa en cada fallo y se reinicia al
  ingresar bien.
- Al **quinto** fallo: `credencial.bloqueado_hasta = ahora + 15 min` y una fila
  `CUENTA_BLOQUEADA` en `auditoria`.
- Mientras está bloqueada, la respuesta es siempre el mismo mensaje genérico
  ("Usuario o contraseña incorrectos"), sin decir cuál de los dos falló.
- El bloqueo temporal **no es un estado del usuario**: es una fecha en
  `credencial`. Un bloqueo administrativo, que no levanta el reloj, es
  `usuario.estado = 'INACTIVO'`.

## 6. Auditoría (RNF-04)

`auditoria` e `intento_login` son **inmutables**: cuatro triggers rechazan
cualquier `UPDATE` o `DELETE` con `SQLSTATE 45000`. Además, el usuario de
aplicación de MariaDB solo debería tener `INSERT` y `SELECT` sobre ellas:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON retiro_seguro.* TO 'retiro_app'@'%';
REVOKE UPDATE, DELETE ON retiro_seguro.auditoria     FROM 'retiro_app'@'%';
REVOKE UPDATE, DELETE ON retiro_seguro.intento_login FROM 'retiro_app'@'%';
```

En `detalle` (JSON) nunca se guardan contraseñas, tokens ni datos sensibles del
menor (Ley 1581 de 2012, RNF-03).

## 7. Cómo se registran los estudiantes y sus acudientes (HU01)

El estudiante **no cuelga de `usuario`**: un niño de preescolar no inicia sesión,
así que no tiene cuenta ni credencial. `usuario` es la tabla de quien entra al
sistema; `estudiante`, la de quien es retirado.

Entre los dos está `acudiente_estudiante`, y es una tabla y no una columna
`acudiente_id` por dos razones del propio backlog: un menor puede tener más de un
adulto responsable (HU03 autoriza terceros, HU05 restringe a uno en particular) y
un acudiente puede tener varios hijos en la institución. Con una columna, el
segundo hermano obligaría a duplicar la cuenta de la madre; con la tabla, se
reutiliza la que ya existe —y es lo que hace el registro de HU01-E1—.

**Un solo titular por estudiante lo garantiza la base de datos.** `titular` es un
booleano, pero la unicidad no se puede expresar con un índice sobre él (dejaría
pasar un solo `FALSE`). Por eso hay una columna generada:

```sql
titular_unico BIGINT UNSIGNED AS (IF(titular, estudiante_id, NULL)) PERSISTENT,
UNIQUE KEY uq_titular_por_estudiante (titular_unico)
```

Vale `estudiante_id` cuando la fila es la titular y `NULL` cuando no. El índice
único admite cualquier cantidad de `NULL` pero un solo valor por estudiante.

**El consentimiento de tratamiento de datos es una tabla con historial, no un
booleano en `estudiante`.** La Ley 1581 de 2012 exige poder demostrar *cuándo* y
*quién* autorizó, y la autorización es revocable: hay que conservar lo que se
aceptó, no sobrescribirlo. `version_aviso` registra contra qué versión del aviso
de privacidad se autorizó, y la estampa el servidor desde
`VERSION_AVISO_PRIVACIDAD`: una constancia legal no puede depender de lo que
envíe el formulario.

Dos estados que se parecen y no son lo mismo:

| Columna | Qué significa | Quién lo cambia |
|---|---|---|
| `usuario.estado` | Si la persona puede entrar al sistema | HU12-E3, `PATCH usuarios/:uuid/desactivar` |
| `acudiente_estudiante.estado` | Si ese adulto sigue respondiendo por ese menor | HU01-E3, `PATCH estudiantes/:uuid/acudientes/:uuid` |

Y `estudiante.actualizado_por` duplica a propósito algo que ya está en
`auditoria`: HU01-E3 exige mostrar en la ficha la fecha y el usuario del último
cambio, y resolverlo con un JOIN a la bitácora en cada consulta sería un escaneo.
La bitácora sigue siendo el rastro completo e inmutable; la columna es solo el
último cambio.

## 8. Trazabilidad con el backlog

| Historia / requisito | Dónde se cumple |
|---|---|
| HU07-E1 inicio de sesión con documento | `usuario.numero_documento` (UNIQUE global), `usuario.estado`, `credencial.hash_contrasena` |
| HU07-E2 bloqueo por 5 intentos | `credencial.intentos_fallidos`, `credencial.bloqueado_hasta`, `intento_login` |
| HU07-E3 enlace válido 30 min | `token_correo.expira_en`, `token_correo.huella` |
| HU12-E1 menú según el rol | `usuario.rol` (el JWT lo lleva en sus claims) |
| HU12-E2 acceso denegado a otro rol | políticas de `@nestjs/authorization` sobre `usuario.rol` |
| HU12-E3 desactivar y cerrar sesiones | `usuario.estado='INACTIVO'` + `UPDATE sesion SET revocada_en` |
| HU01-E1 registro de estudiante y acudiente titular | `estudiante`, `acudiente_estudiante.titular`, `autorizacion_tratamiento_datos`, `usuario.creado_por` |
| HU01-E2 obligatorios y duplicidad | `uq_estudiante_documento`, `uq_usuario_documento`, `uq_usuario_correo`, `uq_titular_por_estudiante` |
| HU01-E3 consulta y actualización | `ix_estudiante_apellidos`, `estudiante.actualizado_por` + `actualizado_en`, `acudiente_estudiante.estado` |
| RNF-03 protección de datos | hash scrypt, collation binaria, `uuid` público en vez del documento, `detalle` sin datos sensibles |
| RNF-04 auditoría no modificable | triggers de `auditoria` e `intento_login` |
