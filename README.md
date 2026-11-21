# Retiro Seguro — API

Backend del sistema de **retiro seguro de estudiantes de preescolar** de la
I.E. Esteban Ochoa (Equipo 1.1). Reemplaza la verificación informal en la
portería por una validación digital auditada: credenciales por rol, pase QR,
autorizaciones a terceros, restricciones de custodia y bitácora.

**Stack**: Node.js + TypeScript · NestJS 12 (ESM) · MariaDB 11 · TypeORM · Vitest.

## Estado

| Entrega | Historias | Estado |
|---|---|---|
| v1 | HU07 (inicio de sesión del acudiente) · HU12 (inicio de sesión del personal por rol) | Diseño de BD y andamiaje listos; endpoints en curso |

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

## Comandos

| Comando | Para qué |
|---|---|
| `npm run start:dev` | API con recarga en caliente |
| `npm run build` | Compila a `dist/` |
| `npm test` / `npm run test:e2e` | Pruebas unitarias / de extremo a extremo |
| `npm run lint` / `npm run format` | Análisis estático / formato |
| `npm run db:up` / `db:down` | Levanta / detiene MariaDB en Docker |
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
