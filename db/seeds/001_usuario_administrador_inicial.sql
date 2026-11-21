-- =============================================================================
--  Semilla · primera cuenta administrativa. Idempotente.
--
--  Queda en PENDIENTE_ACTIVACION y sin contraseña a propósito: nadie, ni el
--  equipo de desarrollo, conoce una contraseña inicial. Se activa con el
--  enlace que el sistema envía al correo, igual que la cuenta de un acudiente.
--
--  Cambie el documento y el correo por los de la secretaría de la institución
--  antes de instalar en el servidor real.
-- =============================================================================

INSERT INTO usuario (uuid, tipo_documento, numero_documento, nombres, apellidos,
                     correo, rol, estado)
VALUES ('00000000-0000-4000-8000-000000000001', 'CC', '1000000001',
        'Secretaría', 'Esteban Ochoa', 'secretaria@iestebanochoa.edu.co',
        'ADMINISTRATIVO', 'PENDIENTE_ACTIVACION')
ON DUPLICATE KEY UPDATE estado = usuario.estado;

-- La fila de credencial se crea junto con la cuenta, con la contraseña en NULL:
-- así el inicio de sesión siempre puede hacer el JOIN sin casos especiales.
INSERT INTO credencial (usuario_id, hash_contrasena)
SELECT u.id, NULL
FROM usuario u
WHERE u.numero_documento = '1000000001'
ON DUPLICATE KEY UPDATE usuario_id = credencial.usuario_id;
