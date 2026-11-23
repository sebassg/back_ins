-- =============================================================================
--  Retiro Seguro — I.E. Esteban Ochoa (Equipo 1.1)
--  Migración 002 · HU01 (gestionar estudiantes y acudientes titulares)
--
--  Idempotente: se puede ejecutar varias veces sin error.
--  Forward-only: una vez aplicada, este archivo NO se edita; los cambios
--  posteriores van en 003_, 004_, etc.
--
--  Cuatro tablas, divididas por responsabilidad:
--    grupo                          → el grupo de preescolar y su hora de salida
--    estudiante                     → quién es el menor
--    acudiente_estudiante           → quién responde por él y con qué parentesco
--    autorizacion_tratamiento_datos → el consentimiento de Ley 1581 de 2012
--
--  Se mantienen las convenciones de la 001:
--   · Motor InnoDB, utf8mb4. Fechas DATETIME(3) y SIEMPRE en UTC.
--   · Documentos en collation binaria: su comparación debe ser exacta.
--   · Nunca se borra un estudiante: se cambia el estado a RETIRADO.
--   · Los catálogos fijos (tipo de documento, jornada, parentesco) son ENUM.
--
--  Por qué el vínculo es una tabla y no una columna `acudiente_id` en
--  estudiante: un menor puede tener más de un adulto responsable (HU03 autoriza
--  terceros, HU05 restringe a uno en particular) y un acudiente puede tener
--  varios hijos en la institución. Una columna obligaría a duplicar la cuenta
--  del acudiente por cada hermano.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. grupo — el curso de preescolar.
--
--    `hora_salida` vive aquí y no en el estudiante porque la salida es del
--    grupo: HU03 mide su plazo de 2 horas contra ella y HU11 la cambia para
--    toda la clase. `docente_id` es la docente titular, quien valida la
--    entrega en portería (HU04) y notifica los cambios de hora (HU11).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grupo (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre         VARCHAR(40)  NOT NULL COMMENT 'Como lo nombra la institución: Transición A, Jardín B',
  jornada        ENUM('MANANA','TARDE','UNICA') NOT NULL DEFAULT 'MANANA',
  hora_salida    TIME         NOT NULL
                 COMMENT 'Hora de salida ordinaria. HU03 exige 2 horas de anticipación contra esta hora; HU11 la cambia por fecha',
  docente_id     BIGINT UNSIGNED NULL COMMENT 'Docente titular (rol DOCENTE). Se valida en la aplicación, no en el ENUM',
  creado_en      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_grupo_nombre (nombre),
  KEY ix_grupo_docente (docente_id),
  CONSTRAINT fk_grupo_docente FOREIGN KEY (docente_id)
    REFERENCES usuario (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 2. estudiante — SOLO información del menor.
--
--    No tiene cuenta ni credencial: un niño de preescolar no inicia sesión.
--    Por eso no cuelga de `usuario`, que es la tabla de quien entra al sistema.
--
--    `tipo_documento` repite la lista de `usuario` para no tener dos catálogos
--    del mismo dato, pero su omisión es RC (registro civil), que es lo que
--    tiene un menor de siete años.
--
--    `actualizado_por` existe porque HU01-E3 exige mostrar en la ficha la fecha
--    y el usuario de la última modificación. El rastro completo e inmutable
--    está en `auditoria` (RNF-04); esta columna es el último cambio, para no
--    tener que escanear la bitácora al abrir cada ficha.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS estudiante (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)     NOT NULL COLLATE utf8mb4_bin
                   COMMENT 'Identificador público: rutas de la API y contenido del QR (HU02). Evita exponer el documento del menor',
  tipo_documento   ENUM('CC','TI','RC','CE','PA','PEP') NOT NULL DEFAULT 'RC',
  numero_documento VARCHAR(20)  NOT NULL COLLATE utf8mb4_bin
                   COMMENT 'Único en el sistema: HU01-E2 rechaza el registro duplicado',
  nombres          VARCHAR(100) NOT NULL,
  apellidos        VARCHAR(100) NOT NULL,
  fecha_nacimiento DATE         NULL,
  grupo_id         BIGINT UNSIGNED NULL,
  estado           ENUM('ACTIVO','RETIRADO') NOT NULL DEFAULT 'ACTIVO'
                   COMMENT 'RETIRADO: ya no estudia en la institución. No se borra la ficha: la bitácora de entregas la referencia',
  creado_por       BIGINT UNSIGNED NULL COMMENT 'Quién registró la ficha (HU01-E1)',
  actualizado_por  BIGINT UNSIGNED NULL COMMENT 'Quién hizo el último cambio (HU01-E3)',
  creado_en        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_estudiante_uuid (uuid),
  UNIQUE KEY uq_estudiante_documento (numero_documento),
  KEY ix_estudiante_grupo_estado (grupo_id, estado),
  KEY ix_estudiante_apellidos (apellidos, nombres),
  KEY ix_estudiante_creado_por (creado_por),
  KEY ix_estudiante_actualizado_por (actualizado_por),
  CONSTRAINT fk_estudiante_grupo FOREIGN KEY (grupo_id)
    REFERENCES grupo (id) ON DELETE SET NULL,
  CONSTRAINT fk_estudiante_creado_por FOREIGN KEY (creado_por)
    REFERENCES usuario (id) ON DELETE SET NULL,
  CONSTRAINT fk_estudiante_actualizado_por FOREIGN KEY (actualizado_por)
    REFERENCES usuario (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 3. acudiente_estudiante — quién responde por el menor.
--
--    La llave primaria es el par: un adulto se vincula una sola vez a un mismo
--    estudiante, y el mismo adulto puede estar vinculado a varios hermanos con
--    una sola cuenta.
--
--    `titular` marca al acudiente titular, el que genera el pase (HU02) y
--    autoriza terceros (HU03). Debe haber UNO por estudiante, y eso se
--    garantiza en la base de datos, no en código: la columna generada
--    `titular_unico` vale `estudiante_id` cuando la fila es la titular y NULL
--    cuando no, y su índice único deja pasar cualquier cantidad de NULL pero
--    un solo valor por estudiante.
--
--    `estado` es el del VÍNCULO, no el de la cuenta: INACTIVO significa que
--    ese adulto ya no responde por ese menor. Desactivar la cuenta de la
--    persona es otra cosa y vive en `usuario.estado` (HU12-E3).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS acudiente_estudiante (
  estudiante_id  BIGINT UNSIGNED NOT NULL,
  usuario_id     BIGINT UNSIGNED NOT NULL COMMENT 'La cuenta del acudiente (rol ACUDIENTE)',
  parentesco     ENUM('MADRE','PADRE','ABUELO','TIO','HERMANO','TUTOR_LEGAL','OTRO') NOT NULL,
  titular        BOOLEAN      NOT NULL DEFAULT FALSE
                 COMMENT 'Acudiente titular: genera el pase (HU02) y autoriza terceros (HU03)',
  titular_unico  BIGINT UNSIGNED AS (IF(titular, estudiante_id, NULL)) PERSISTENT
                 COMMENT 'Solo existe para sostener uq_titular_por_estudiante: un titular por estudiante',
  estado         ENUM('ACTIVO','INACTIVO') NOT NULL DEFAULT 'ACTIVO'
                 COMMENT 'Del vínculo, no de la cuenta (HU01-E3)',
  creado_en      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actualizado_en DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (estudiante_id, usuario_id),
  UNIQUE KEY uq_titular_por_estudiante (titular_unico),
  KEY ix_acudiente_estudiante_usuario (usuario_id, estado),
  CONSTRAINT fk_vinculo_estudiante FOREIGN KEY (estudiante_id)
    REFERENCES estudiante (id) ON DELETE CASCADE,
  CONSTRAINT fk_vinculo_usuario FOREIGN KEY (usuario_id)
    REFERENCES usuario (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- 4. autorizacion_tratamiento_datos — el consentimiento de la Ley 1581 de 2012.
--
--    Es una tabla y no un booleano en `estudiante` porque la ley exige poder
--    demostrar CUÁNDO y QUIÉN autorizó, y porque el consentimiento es
--    revocable: hay que conservar el histórico, no sobrescribirlo.
--
--    `version_aviso` guarda contra qué versión del aviso de privacidad se
--    autorizó. Si el aviso cambia, las autorizaciones viejas siguen siendo
--    prueba de lo que se aceptó en su momento.
--
--    Las llaves foráneas son RESTRICT: es un soporte legal, no se arrastra con
--    el borrado de nadie.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS autorizacion_tratamiento_datos (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  estudiante_id   BIGINT UNSIGNED NOT NULL,
  otorgado_por    BIGINT UNSIGNED NOT NULL COMMENT 'El acudiente que autoriza el tratamiento de los datos del menor',
  registrado_por  BIGINT UNSIGNED NULL COMMENT 'El funcionario que dejó constancia (HU01-E1)',
  version_aviso   VARCHAR(20)  NOT NULL COMMENT 'Versión del aviso de privacidad aceptada',
  otorgado_en     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  revocado_en     DATETIME(3)  NULL COMMENT 'La autorización es revocable; la fila no se borra',
  PRIMARY KEY (id),
  KEY ix_autorizacion_estudiante (estudiante_id, revocado_en),
  KEY ix_autorizacion_otorgado_por (otorgado_por),
  KEY ix_autorizacion_registrado_por (registrado_por),
  CONSTRAINT fk_autorizacion_estudiante FOREIGN KEY (estudiante_id)
    REFERENCES estudiante (id) ON DELETE RESTRICT,
  CONSTRAINT fk_autorizacion_otorgado_por FOREIGN KEY (otorgado_por)
    REFERENCES usuario (id) ON DELETE RESTRICT,
  CONSTRAINT fk_autorizacion_registrado_por FOREIGN KEY (registrado_por)
    REFERENCES usuario (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
