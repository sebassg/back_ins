# Arquitectura del backend

> Documento de referencia del equipo y base para la sección de arquitectura del
> informe. Acompaña a `db/README.md`, que explica el modelo de datos.

## No es MVC

Conviene decirlo con precisión, porque el nombre se presta a confusión: **esto no
es MVC**. El patrón MVC necesita una **Vista** que el servidor renderiza; aquí el
backend es una API REST que devuelve JSON y la vista vive en el cliente (la app
del acudiente y el panel web institucional). NestJS *puede* trabajar con
plantillas y hacer MVC, pero no es lo que estamos construyendo: que llame
`controller` y `service` a sus piezas es herencia de Angular, no una indicación
de MVC.

Lo que implementamos es una **arquitectura en capas sobre un monolito modular**,
con inyección de dependencias.

## Vista del sistema: tres niveles

```
┌────────────────────────┐   HTTPS/JSON   ┌────────────────────────┐   SQL   ┌──────────┐
│  Cliente               │ ──────────────▶│  API REST (NestJS)     │ ───────▶│ MariaDB  │
│  app móvil · panel web │                │  reglas del negocio    │         │  datos   │
│  vista y estado de UI  │◀────────────── │  autenticación y roles │◀─────── │          │
└────────────────────────┘                └────────────────────────┘         └──────────┘
```

El backend no tiene vista. El cliente no habla con la base de datos. Toda regla
que proteja a un menor —quién puede retirarlo, con qué pase, en qué horario— vive
en la API, nunca en el cliente, porque un cliente se puede modificar.

## Vista interna: capas

Cada petición atraviesa las mismas tres capas, siempre en el mismo sentido:

```
Controller  ── HTTP: recibe el DTO, lo valida, traduce el resultado a códigos de estado.
   │           No contiene reglas de negocio.
   ▼
Service     ── Las reglas: los 5 intentos de HU07-E2, los 15 minutos de bloqueo,
   │           los 30 minutos del enlace de HU07-E3, qué se audita.
   │           No sabe de HTTP ni escribe SQL.
   ▼
Repository  ── Acceso a datos con TypeORM sobre las tablas de db/.
               No contiene reglas de negocio.
```

Una capa solo llama a la de abajo. Si un servicio necesita a otro servicio, se
inyecta; si dos módulos se necesitan entre sí, es señal de que falta mover algo.

**Por qué repositorio propio y no TypeORM en el servicio**: porque así las reglas
se pueden probar sin base de datos. El test de "al quinto intento se bloquea 15
minutos" no debería necesitar un contenedor de MariaDB corriendo.

## Estructura de un módulo

```
src/modules/auth/
├── auth.module.ts
├── auth.controller.ts        HTTP: DTOs, códigos, cabeceras
├── auth.service.ts           reglas: 5 intentos, 15 min, 30 min
├── dto/                      forma de la petición y de la respuesta
├── entities/                 mapeo TypeORM de las tablas de db/
├── repositories/             consultas
├── policies/                 quién puede qué (HU12-E2)
└── stores/                   adaptadores de @nestjs/authentication
```

### Las carpetas transversales

```
src/
├── config/      validación del .env con zod; la app no arranca si falta algo
├── database/    conexión a MariaDB (synchronize: false)
├── common/      decoradores, filtros e interceptores compartidos
├── salud/       endpoint de estado
└── modules/     un módulo por área del dominio
```

### Dos matices que impone el entorno

- **`stores/` son puertos y adaptadores.** `RefreshTokenStore` y `EmailTokenStore`
  son interfaces que define `@nestjs/authentication`; nosotros escribimos su
  implementación contra MariaDB. Es arquitectura hexagonal en pequeño, impuesta
  por el framework, y conviene respetar sus reglas de escritura condicional y
  atomicidad (están documentadas en los typings del paquete).
- **`policies/` no son tablas.** El control de acceso de HU12-E2 se expresa en
  código, con las políticas de `@nestjs/authorization`, sobre el ENUM
  `usuario.rol`. Ver `db/README.md` para el porqué de no tener tablas de permisos.

## Mapa de módulos y su relación con el backlog

| Módulo | Historias | Qué contiene |
|---|---|---|
| `auth` | HU07, HU12 | Inicio de sesión, renovación, cierre, activación y recuperación. Políticas por rol |
| `usuarios` | HU01, HU12 | Provisión de cuentas, consulta y desactivación |
| `estudiantes` | HU01 | Estudiantes, grupos y su vínculo con acudientes |
| `pases` | HU02, HU03 | Código QR del titular y autorizaciones temporales a terceros |
| `entregas` | HU04, HU06 | Validación en portería, registro de la entrega y alertas |
| `restricciones` | HU05, HU06 | Restricciones de custodia con soporte legal e incidentes |
| `excepciones` | HU08 | Autorizaciones de emergencia aprobadas por coordinación |
| `excusas` | HU09 | Excusas médicas y retiro anticipado |
| `jornada` | HU11 | Cambios en la hora de salida y su notificación |
| `auditoria` | HU10, RNF-04 | Escritura de la bitácora y los reportes del rector |

Los módulos se organizan **por área del dominio, no por capa técnica**: no existe
una carpeta `controllers/` con todos los controladores. La regla para ubicar un
archivo nuevo es "¿de qué habla?", no "¿qué tipo de clase es?".

## Decisiones y lo que se descartó

| Decisión | Por qué |
|---|---|
| Capas por módulo | Es el Nest idiomático: lo que el equipo va a encontrar en cualquier ejemplo o documentación |
| Monolito modular, no microservicios | Un colegio, un despliegue, cinco desarrolladores aprendiendo el framework. Los módulos ya marcan las fronteras si algún día hiciera falta separar |
| Hexagonal completa, descartada | Dominio puro, casos de uso y puertos son cuatro carpetas y tres archivos por operación: para 12 historias y este equipo, la ceremonia cuesta más de lo que aporta. Donde sí aplica (los stores) está, porque el framework lo impone |
| TypeORM solo como mapeador | El esquema es de los scripts de `db/`; TypeORM corre con `synchronize: false` |
