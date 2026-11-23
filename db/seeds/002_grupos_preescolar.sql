-- =============================================================================
--  Semilla · grupos de preescolar. Idempotente.
--
--  HU01 exige elegir el grupo del estudiante, así que la instalación trae los
--  dos grupos de transición para que haya con qué registrar desde el primer
--  arranque. Ajuste los nombres y la hora de salida a los de la institución
--  antes de instalar en el servidor real.
--
--  `docente_id` queda en NULL: la docente titular se asigna cuando exista su
--  cuenta. HU11 es la historia que gestiona la hora de salida.
-- =============================================================================

INSERT INTO grupo (nombre, jornada, hora_salida)
VALUES ('Transición A', 'MANANA', '12:00:00'),
       ('Transición B', 'MANANA', '12:00:00')
ON DUPLICATE KEY UPDATE hora_salida = grupo.hora_salida;
