# Retiro Seguro — API

Backend del sistema de **retiro seguro de estudiantes de preescolar** de la
I.E. Esteban Ochoa (Equipo 1.1). Reemplaza la verificación informal en la
portería por una validación digital auditada: credenciales por rol, pase QR,
autorizaciones a terceros, restricciones de custodia y bitácora.

**Stack**: Node.js + TypeScript · NestJS 12 (ESM) · MariaDB 11 · TypeORM · Vitest.

## Estado

| Entrega | Historias | Estado |
|---|---|---|
| v1 | HU07 (inicio de sesión del acudiente) · HU12 (inicio de sesión del personal por rol) | Endpoints implementados, con pruebas unitarias y e2e |

El diseño de la base de datos, el modelo de sesión y el de roles están en
**[`db/README.md`](db/README.md)**; el diagrama ER, en
[`db/diagrama/er.mmd`](db/diagrama/er.mmd). La arquitectura del backend —capas,
módulos y por qué no es MVC— está en **[`docs/arquitectura.md`](docs/arquitectura.md)**.

## Puesta en marcha

```bash
npm install --legacy-peer-deps   # ver nota al final
cp .env.example .env             # genere JWT_SECRET y ajuste las credenciales
npm run db:up                    # MariaDB en Docker
npm run db:install               # aplica db/migrations/* y db/seeds/*
npm run start:dev                # API en http://localhost:3000/api/v1
```

Comprobación rápida: `curl http://localhost:3000/api/v1/salud`

Los correos de activación y recuperación llegan a Mailpit:
<http://localhost:8025>.

### Primer ingreso (cuenta administrativa de la semilla)

La semilla crea la cuenta de secretaría sin contraseña. Para activarla:

```bash
curl -X POST localhost:3000/api/v1/auth/reenviar-activacion \
  -H 'Content-Type: application/json' -d '{"numeroDocumento":"1000000001"}'
# Abra el correo en Mailpit, copie el token del enlace y:
curl -X POST localhost:3000/api/v1/auth/activar \
  -H 'Content-Type: application/json' -d '{"token":"<token>","contrasena":"<su contraseña>"}'
```

## Endpoints (v1)

Todas las rutas están bajo `/api/v1`. Las de `auth/` son públicas; el resto
exige `Authorization: Bearer <accessToken>`.

| Método y ruta | Historia | Qué hace |
|---|---|---|
| `POST auth/iniciar-sesion` | HU07-E1, HU12-E1 | Documento y contraseña → `accessToken` (15 min), `refreshToken` (30 d) y el rol |
| `POST auth/renovar` | — | Rota el refresh token; reusar uno ya usado cierra la sesión entera |
| `POST auth/cerrar-sesion` | — | Cierra la sesión del dispositivo |
| `POST auth/recuperar-contrasena` | HU07-E3 | Envía el enlace (30 min, un uso) al correo registrado; misma respuesta exista o no el documento |
| `POST auth/restablecer-contrasena` | HU07-E3 | Token del enlace + contraseña nueva; cierra todas las sesiones |
| `POST auth/reenviar-activacion` | HU07-E1 | Reenvía el enlace de activación (72 h) a una cuenta pendiente |
| `POST auth/activar` | HU07-E1 | Token del enlace + la contraseña que la persona elige |
| `GET usuarios/yo` | HU12-E1 | Perfil y rol, para armar el menú |
| `PATCH usuarios/:uuid/desactivar` | HU12-E2, HU12-E3 | Solo `ADMINISTRATIVO`; cierra todas las sesiones del usuario |

Un fallo de inicio de sesión responde siempre 401 `Usuario o contraseña
incorrectos`; al quinto fallo la cuenta se bloquea 15 minutos (HU07-E2). Las
rutas de `auth/` tienen un límite de 10 peticiones por minuto.

`npm run test:e2e` necesita la base de datos arriba (`npm run db:up && npm run db:install`).

## Comandos

| Comando | Para qué |
|---|---|
| `npm run start:dev` | API con recarga en caliente |
| `npm run build` | Compila a `dist/` |
| `npm test` / `npm run test:e2e` | Pruebas unitarias / de extremo a extremo |
| `npm run lint` / `npm run format` | Análisis estático / formato |
| `npm run db:up` / `db:down` | Levanta / detiene MariaDB y Mailpit en Docker |
| `npm run db:install` | Aplica migraciones y semillas (idempotente) |
| `npm run db:reset` | **Borra** el volumen y reconstruye la BD desde cero |

## Estructura

```
db/                  esquema SQL, semillas y diagrama ER (fuente de verdad)
src/
├── config/          validación del .env con zod (falla al arrancar si algo falta)
├── database/        conexión a MariaDB (synchronize: false)
├── salud/           endpoint de estado
├── common/          decoradores, guards y filtros compartidos
└── modules/         un módulo por área del dominio (auth, usuarios, ...)
test/                pruebas de extremo a extremo
```

## Notas

- El esquema **solo** cambia agregando un script en `db/migrations/`. TypeORM no
  crea ni altera tablas.
- `.env` no se versiona. `JWT_SECRET` debe tener 32 caracteres o más:
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
- La instalación usa `--legacy-peer-deps` por un fallo de resolución de pares de
  npm 10.9 con el grafo de Vitest (`Cannot read properties of null (reading
  'edgesOut')`). Con el `package-lock.json` versionado, `npm install` ya funciona
  sin la bandera.
