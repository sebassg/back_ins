# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

The official NestJS agent skills are installed with `npx @nestjs/skills add --agent all`, which also updates them: the mistakes agents make in Nest apps, with recipes checked on the released packages. An agent loads a skill when a task matches it.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

A route handler can return a web `Response`, a `ReadableStream` or an async generator, and Nest streams it as it's produced (https://docs.nestjs.com/http/streaming-responses.md).

Nest's packages are ESM only, and this project is ESM too: relative imports end in `.js`, `__dirname` doesn't exist (use `import.meta.dirname`), and tests run on Vitest, so mocks are `vi.fn()`, not `jest.fn()`.

In this project, `src/main.ts` creates the app and listens on `PORT` (3000 by default), `src/app.module.ts` is the root module that imports the others, and `AppController` and `AppService` are samples. Unit tests sit beside the code as `*.spec.ts` and the e2e test is in `test/`; Vitest runs them (`npm test`, `npm run test:e2e`).

When a task says how to test, follow it. When it says nothing, cover the behaviour you change with focused tests rather than adding broad e2e suites.

## Este proyecto

API del sistema de retiro seguro de estudiantes de la I.E. Esteban Ochoa
(Equipo 1.1). El backlog define 12 historias; la entrega en curso es HU07
(inicio de sesión del acudiente) y HU12 (inicio de sesión del personal por rol).

- **Arquitectura en capas sobre un monolito modular, no MVC** (el backend no
  tiene vista: es una API REST). Por petición: `Controller` (HTTP, DTOs, códigos)
  → `Service` (las reglas) → `Repository` (TypeORM). Una capa solo llama a la de
  abajo; el controlador no lleva reglas y el servicio no escribe SQL ni sabe de
  HTTP. Los módulos se organizan por área del dominio, no por capa técnica: no
  hay una carpeta `controllers/` global. El detalle y el mapa de módulos por
  historia están en `docs/arquitectura.md`.
- **El esquema de la base de datos vive en `db/migrations/*.sql`, y es la única
  fuente de verdad.** TypeORM corre con `synchronize: false` y solo mapea tablas
  existentes: nunca las crea ni las altera. Un cambio de esquema es un script
  nuevo (forward-only, numerado), más una actualización de `db/diagrama/er.mmd`
  y de `db/diagrama/CHANGELOG.md`. El diseño y su porqué están en `db/README.md`:
  léalo antes de tocar las tablas de usuarios o de sesión.
- **Siete tablas, separadas por responsabilidad**: `usuario` (quién es la
  persona), `credencial` (1:1, lo que cambia al entrar: hash, intentos fallidos,
  bloqueo), `sesion` (una por inicio de sesión, es lo que se revoca),
  `refresh_token`, `token_correo`, `intento_login` y `auditoria`. No mueva
  columnas de acceso a `usuario` ni agregue banderas deducibles del estado
  (no existe un `debe_cambiar_contrasena` a propósito).
- **El rol es un dato técnico quemado**: ENUM `usuario.rol` con `ACUDIENTE`,
  `DOCENTE` y `ADMINISTRATIVO`. Los permisos se expresan en código, con las
  políticas de `@nestjs/authorization`, no en tablas. No introduzca `permiso` ni
  `rol_permiso` sin que una historia lo pida; el camino está escrito en
  `db/diagrama/CHANGELOG.md`.
- **Los catálogos fijos son ENUM, no tablas** (tipo de documento, rol, motivos).
- **Dominio en español, técnica en inglés.** Tablas, columnas, entidades y
  nombres del negocio en español (`usuario`, `credencial`, `intento_login`),
  igual que el backlog; los nombres propios del framework, como siempre.
- **Autenticación y autorización con los paquetes de Nest**:
  `@nestjs/authentication` (refresh tokens con rotación y detección de reuso,
  enlaces de correo; contraseñas con scrypt vía `CredentialsService`) y
  `@nestjs/authorization` (políticas con `@Can()`). `sesion` + `refresh_token`
  implementan el contrato `RefreshTokenStore` (la `sesion` es la *familia*) y
  `token_correo` el contrato `EmailTokenStore`: al implementar esos stores,
  respete sus reglas de escritura condicional y atomicidad, documentadas en los
  propios typings. No se usa `SessionStore`: no hay sesión por cookie.
- **Reglas del backlog que el código debe sostener**: mensaje de error genérico
  y bloqueo de 15 minutos al quinto intento fallido (HU07-E2); enlace de
  recuperación de 30 minutos y de un solo uso (HU07-E3); al desactivar un
  funcionario se cierran sus sesiones (HU12-E3); `auditoria` e `intento_login`
  son inmutables (RNF-04); nunca se registran contraseñas, tokens ni datos
  sensibles de un menor en bitácoras o logs (Ley 1581 de 2012, RNF-03).
- `npm install` usa `--legacy-peer-deps` por un fallo de npm 10.9 al resolver el
  grafo de pares de Vitest.
