-- =============================================================================
--  Retiro Seguro — I.E. Esteban Ochoa (Equipo 1.1)
--  Migración 001 · HU07 (inicio de sesión del acudiente)
--                 HU12 (inicio de sesión del personal institucional por rol)
--
--  Idempotente: se puede ejecutar varias veces sin error.
--  Forward-only: una vez aplicada, este archivo NO se edita; los cambios
--  posteriores van en 002_, 003_, etc.
--
--  Siete tablas, divididas por responsabilidad:
--    usuario        → quién es la persona
--    credencial     → cómo entra y qué le pasa cuando falla al entrar
--    sesion         → cada inicio de sesión, revocable
--    refresh_token  → los tokens que rotan dentro de una sesión
--    token_correo   → enlaces de activación y recuperación
--    intento_login  → bitácora de intentos (HU07-E2)
--    auditoria      → bitácora institucional inmutable (RNF-04)
--
--  Convenciones:
--   · Motor InnoDB, utf8mb4. Fechas DATETIME(3) y SIEMPRE en UTC.
--   · Tokens, hashes, correos y documentos en collation binaria: su
--     comparación debe ser exacta, sin equivalencias de acentos ni mayúsculas.
--   · Nunca se borra un usuario ni una fila de bitácora: se cambia el estado.
--   · Los catálogos fijos (tipo de documento, rol) son ENUM, no tablas: son
--     datos técnicos del sistema, no información que la institución administre.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. usuario — SOLO información de la persona.
--
--    Nada de lo que cambia al iniciar sesión vive aquí: eso está en credencial.
--
--    Sobre el rol: se queman los tres roles del sistema como ENUM. Los cargos
--    administrativos (coordinación, rectoría, secretaría) comparten
--    funcionalidad y se diferencian en permisos, no en pantallas, así que se
--    agrupan en ADMINISTRATIVO. Si más adelante la institución necesita
--    administrar permisos por cargo, el camino es agregar las tablas
--    rol / permiso / rol_permiso en una migración posterior y migrar este
--    ENUM a una llave foránea; hoy serían tablas vacías de requisito.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuario (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)     NOT NULL COLLATE utf8mb4_bin
                   COMMENT 'Identificador público: claim sub del JWT y rutas de la API. Evita exponer el documento o un id secuencial',
  tipo_documento   ENUM('CC','TI','RC','CE','PA','PEP') NOT NULL DEFAULT 'CC',
  numero_documento VARCHAR(20)  NOT NULL COLLATE utf8mb4_bin
                   COMMENT 'Usuario de inicio de sesión (HU07-E1). Único en todo el sistema: debe identificar sin ambigüedad',
  nombres          VARCHAR(100) NOT NULL,
  apellidos        VARCHAR(100) NOT NULL,
  correo           VARCHAR(150) NULL COLLATE utf8mb4_bin
                   COMMENT 'Destino del enlace de activación y de recuperación (HU07-E3). La aplicación lo normaliza a minúsculas',
  telefono         VARCHAR(20)  NULL COMMENT 'Reservado para el canal SMS',
  rol              ENUM('ACUDIENTE','DOCENTE','ADMINISTRATIVO') NOT NULL,
  estado           ENUM('PENDIENTE_ACTIVACION','ACTIVO','INACTIVO') NOT NULL
                   DEFAULT 'PENDIENTE_ACTIVACION'
                   COMMENT 'PENDIENTE_ACTIVACION: cuenta creada por la institución, sin contraseña. INACTIVO: desactivada (HU12-E3). El bloqueo temporal por intentos fallidos NO es un estado: vive en credencial.bloqueado_hasta',
  creado_por       BIGINT UNSIGNED NULL COMMENT 'Quién provisionó la cuenta (HU01-E3)',
  creado_en        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuario_uuid (uuid),
  UNIQUE KEY uq_usuario_documento (numero_documento),
  UNIQUE KEY uq_usuario_correo (correo),
  KEY ix_usuario_por_rol_estado (rol, estado),
  KEY ix_usuario_creado_por (creado_por),
  CONSTRAINT fk_usuario_creado_por FOREIGN KEY (creado_por) REFERENCES usuario (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Personas con cuenta: acudientes y personal institucional (HU07, HU12).';

-- -----------------------------------------------------------------------------
-- 2. credencial — todo lo que cambia al entrar (o al fallar al entrar).
--    Relación 1:1 con usuario. Se crea junto con la cuenta, con la contraseña
--    en NULL hasta que la persona la define desde el enlace de activación.
--
--    No existe una columna "debe cambiar la contraseña": es deducible.
--    Una cuenta sin contraseña está en PENDIENTE_ACTIVACION, y como siempre
--    se activa por enlace, el usuario final nunca recibe una contraseña que
--    deba cambiar después.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credencial (
  usuario_id        BIGINT UNSIGNED  NOT NULL,
  hash_contrasena   VARCHAR(255)     NULL COLLATE utf8mb4_bin
                    COMMENT 'scrypt de CredentialsService ($scrypt$ln=17,r=8,p=1$...). NULL mientras la cuenta no se ha activado',
  intentos_fallidos TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'HU07-E2: se bloquea al quinto',
  bloqueado_hasta   DATETIME(3)      NULL COMMENT 'HU07-E2: bloqueo temporal de 15 minutos',
  ultimo_ingreso_en DATETIME(3)      NULL,
  actualizado_en    DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (usuario_id),
  CONSTRAINT fk_credencial_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Estado de acceso de cada usuario (HU07-E1, HU07-E2).';

-- -----------------------------------------------------------------------------
-- 3. sesion — una fila por inicio de sesión, no por petición.
--    Es la "familia" de refresh tokens que exige RefreshTokenStore: los tokens
--    rotan dentro de ella y la sesión es lo que se revoca.
--
--    Aquí aterriza HU12-E3 en una sola sentencia:
--      UPDATE sesion SET revocada_en = NOW(3), motivo_revocacion = 'USUARIO_DESACTIVADO'
--      WHERE usuario_id = ? AND revocada_en IS NULL;
--
--    Revocar la sesión y no los tokens es lo correcto: un refresh que llegue
--    un instante después nace apuntando a una sesión ya revocada, así que
--    tampoco sirve.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sesion (
  id                CHAR(36)     NOT NULL COLLATE utf8mb4_bin
                    COMMENT 'Identificador de la familia de refresh tokens, generado al iniciar sesión',
  usuario_id        BIGINT UNSIGNED NOT NULL,
  creado_en         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expira_en         DATETIME(3)  NOT NULL
                    COMMENT 'Techo absoluto de la sesión (90 días): rotar no lo extiende',
  ultimo_uso_en     DATETIME(3)  NULL COMMENT 'Última renovación, para la pantalla de dispositivos activos',
  revocada_en       DATETIME(3)  NULL,
  motivo_revocacion ENUM('CIERRE_SESION','USUARIO_DESACTIVADO','CAMBIO_CONTRASENA',
                         'REUSO_DETECTADO','ADMINISTRATIVA') NULL,
  claims            JSON         NULL
                    COMMENT 'Claims fijados al iniciar sesión (amr, auth_time); los heredan todos los tokens de la sesión',
  ip                VARBINARY(16) NULL COMMENT 'INET6_ATON(ip)',
  user_agent        VARCHAR(255) NULL,
  dispositivo       VARCHAR(100) NULL,
  PRIMARY KEY (id),
  KEY ix_sesion_usuario_activa (usuario_id, revocada_en),
  KEY ix_sesion_expira (expira_en),
  CONSTRAINT fk_sesion_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Sesiones abiertas; una por inicio de sesión, revocables (HU12-E3).';

-- -----------------------------------------------------------------------------
-- 4. refresh_token — los tokens que rotan dentro de una sesión.
--    Se guarda solo el SHA-256; el token en claro nunca toca la base de datos.
--    Cada token vale UNA vez: si reaparece uno ya usado, dos partes lo tienen
--    (la aplicación y quien lo copió) y se revoca la sesión completa.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_token (
  id        CHAR(64)    NOT NULL COLLATE utf8mb4_bin COMMENT 'SHA-256 del refresh token',
  sesion_id CHAR(36)    NOT NULL COLLATE utf8mb4_bin,
  creado_en DATETIME(3) NOT NULL,
  expira_en DATETIME(3) NOT NULL COMMENT 'Vencimiento de este token (30 días)',
  usado_en  DATETIME(3) NULL
            COMMENT 'Se marca con una escritura condicional (UPDATE ... WHERE usado_en IS NULL)',
  PRIMARY KEY (id),
  KEY ix_refresh_token_sesion (sesion_id),
  KEY ix_refresh_token_expira (expira_en),
  CONSTRAINT fk_refresh_token_sesion FOREIGN KEY (sesion_id) REFERENCES sesion (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Refresh tokens rotatorios de cada sesión.';

-- -----------------------------------------------------------------------------
-- 5. token_correo — enlaces enviados al correo registrado.
--    Un solo mecanismo para los dos flujos, porque son el mismo problema
--    (probar que alguien controla el correo y dejarlo fijar una contraseña):
--      · activación de la cuenta creada por la institución → 72 horas
--      · recuperación de contraseña (HU07-E3)              → 30 minutos
--    El token se consume de forma atómica y la fila se borra; el rastro del
--    hecho queda en auditoria, no aquí.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS token_correo (
  id         CHAR(64)     NOT NULL COLLATE utf8mb4_bin COMMENT 'SHA-256 del token; el token solo existe en el correo',
  proposito  ENUM('password-reset','email-verification') NOT NULL
             COMMENT 'Valores exigidos por el contrato EmailTokenStore',
  usuario_id BIGINT UNSIGNED NOT NULL,
  correo     VARCHAR(150) NOT NULL COLLATE utf8mb4_bin
             COMMENT 'Dirección a la que se envió y la única para la que sirve',
  huella     CHAR(64)     NULL COLLATE utf8mb4_bin
             COMMENT 'SHA-256 del hash de contraseña al emitir: cualquier cambio invalida los enlaces anteriores',
  creado_en  DATETIME(3)  NOT NULL,
  expira_en  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_token_correo_usuario (usuario_id, proposito),
  KEY ix_token_correo_expira (expira_en),
  CONSTRAINT fk_token_correo_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Tokens de activación y recuperación (HU07-E3).';

-- -----------------------------------------------------------------------------
-- 6. intento_login — HU07-E2. Alimenta la regla de los cinco intentos y
--    permite analizar ataques. usuario_id queda NULL si el documento no
--    existe, para no revelar qué documentos están registrados.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intento_login (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id          BIGINT UNSIGNED NULL,
  documento_ingresado VARCHAR(20)     NOT NULL COLLATE utf8mb4_bin,
  exitoso             BOOLEAN         NOT NULL,
  motivo_fallo        ENUM('CREDENCIAL_INVALIDA','USUARIO_INEXISTENTE','CUENTA_BLOQUEADA',
                           'CUENTA_INACTIVA','CUENTA_SIN_ACTIVAR') NULL,
  ip                  VARBINARY(16)   NULL COMMENT 'INET6_ATON(ip)',
  user_agent          VARCHAR(255)    NULL,
  creado_en           DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_intento_documento_fecha (documento_ingresado, creado_en),
  KEY ix_intento_usuario_fecha (usuario_id, creado_en),
  CONSTRAINT fk_intento_login_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bitácora de intentos de inicio de sesión (HU07-E2).';

-- -----------------------------------------------------------------------------
-- 7. auditoria — bitácora institucional. RNF-04: no se puede modificar ni
--    borrar; los triggers de abajo lo impiden incluso para el DBA.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auditoria (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id BIGINT UNSIGNED NULL COMMENT 'Quién ejecutó la acción; NULL si fue el sistema',
  rol        VARCHAR(30)     NULL
             COMMENT 'Rol con el que actuaba, congelado al momento del hecho. VARCHAR y no ENUM: un registro histórico no debe depender de los roles de hoy',
  accion     VARCHAR(60)     NOT NULL
             COMMENT 'LOGIN_EXITOSO, LOGIN_FALLIDO, CUENTA_BLOQUEADA, USUARIO_CREADO, USUARIO_DESACTIVADO, CONTRASENA_RESTABLECIDA, SESIONES_REVOCADAS, ...',
  entidad    VARCHAR(40)     NULL COMMENT 'Tabla o agregado afectado',
  entidad_id VARCHAR(64)     NULL COMMENT 'Identificador del registro afectado (id o uuid)',
  detalle    JSON            NULL COMMENT 'Contexto del hecho. Nunca contraseñas, tokens ni datos sensibles del menor',
  ip         VARBINARY(16)   NULL,
  creado_en  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_auditoria_accion_fecha (accion, creado_en),
  KEY ix_auditoria_entidad (entidad, entidad_id),
  KEY ix_auditoria_usuario_fecha (usuario_id, creado_en),
  CONSTRAINT fk_auditoria_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Bitácora inmutable de acciones (RNF-04, insumo de HU10).';

-- -----------------------------------------------------------------------------
-- Inmutabilidad de las bitácoras (RNF-04)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE TRIGGER trg_auditoria_no_update
BEFORE UPDATE ON auditoria FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RNF-04: la bitacora de auditoria es inmutable, no admite UPDATE.';

CREATE OR REPLACE TRIGGER trg_auditoria_no_delete
BEFORE DELETE ON auditoria FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RNF-04: la bitacora de auditoria es inmutable, no admite DELETE.';

CREATE OR REPLACE TRIGGER trg_intento_login_no_update
BEFORE UPDATE ON intento_login FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RNF-04: la bitacora de intentos de login es inmutable, no admite UPDATE.';

CREATE OR REPLACE TRIGGER trg_intento_login_no_delete
BEFORE DELETE ON intento_login FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RNF-04: la bitacora de intentos de login es inmutable, no admite DELETE.';
