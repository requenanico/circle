# Spec: migración de TaskOS a Circle sobre Supabase

Fecha: 2026-08-25  
Estado: aprobado para planificación  
Proyecto Supabase destino: `abazmhlhnccdfjwmojvs`

## 1. Resumen

Circle reemplazará sus datos mock por una aplicación persistente sobre Supabase. Los datos existentes de TaskOS se copiarán desde Neon/Postgres al proyecto Supabase destino y se transformarán al modelo de Circle sin modificar ni eliminar la fuente.

La aplicación tendrá dos cuentas independientes: una de trabajo y otra freelance. Ambas iniciarán sesión con OAuth —Google o Microsoft/Azure— y cada una tendrá un workspace privado. El aislamiento se aplicará en la base mediante Row Level Security (RLS), no solamente mediante filtros de interfaz.

La migración será progresiva. TaskOS/Neon permanecerá disponible como respaldo hasta verificar lecturas, escrituras, métricas, autenticación y aislamiento.

## 2. Situación actual verificada

### 2.1 Circle

Circle es actualmente una interfaz Next.js sin backend persistente:

- Los datos provienen de `mock-data/*`.
- Zustand administra tanto estado efímero de UI como mutaciones de datos en memoria.
- No existen Route Handlers de datos, cliente de base de datos ni autenticación.
- 114 archivos consumen directamente módulos de `mock-data`.
- 68 archivos de aplicación consumen stores de Zustand.
- El modelo visual espera organizaciones, equipos, usuarios, proyectos, issues, estados, prioridades, labels, ciclos, iniciativas, documentos y reviews.

### 2.2 TaskOS

TaskOS usa Neon/Postgres como fuente activa. Las migraciones históricas de Supabase y la documentación que menciona SQLite no representan el runtime actual.

Conteos verificados en la base de Neon al 2026-08-25:

| Tabla | Filas |
|---|---:|
| `projects` | 18 |
| `tasks` | 371 |
| `time_entries` | 374 |
| `requesters` | 14 |

Distribución funcional:

- 29 tareas de Diseño.
- 342 tareas de Job Boards.
- 7 tareas con `parent_id`.
- 144 tareas con fecha límite.
- 341 tareas con vínculo de ClickUp.
- 342 tareas con solicitante.
- 1 tarea con descripción.
- 0 tareas con prioridad cargada.
- 0 tareas huérfanas y 0 referencias de padre rotas.

Estados existentes:

- `Entregado`: 308
- `Post producción`: 26
- `Not started`: 25
- `Done`: 3
- `Cambios / actualización`: 3
- `Solicitudes`: 3
- `En espera`: 2
- `In progress`: 1

El esquema vivo contiene `tasks.parent_id`, pero esa columna no aparece en la migración baseline versionada. Antes de copiar datos se debe capturar el esquema real como referencia canónica.

## 3. Objetivos

1. Convertir Supabase en la única fuente de verdad de Circle.
2. Importar íntegramente los datos actuales de TaskOS.
3. Incorporar autenticación OAuth con Google y Microsoft/Hotmail.
4. Mantener completamente separados los datos de trabajo y freelance.
5. Sustituir gradualmente mocks y mutaciones locales por datos persistentes.
6. Conservar las capacidades particulares de Diseño y Job Boards.
7. Permitir que TaskOS/Neon funcione como respaldo durante la estabilización.
8. Establecer una base extensible para equipos, labels, ciclos y demás funciones de Circle.

## 4. Fuera de alcance

- Colaboración entre las dos cuentas.
- Compartir workspaces, proyectos o tareas entre usuarios.
- Migrar usuarios porque TaskOS no posee autenticación ni usuarios.
- Implementar en la primera fase iniciativas, reviews, documentos o integraciones externas.
- Sincronización bidireccional permanente entre Neon y Supabase.
- Eliminar la base Neon o sus datos.
- Rediseñar la experiencia visual de Circle.
- Incorporar email/password, magic links o proveedores OAuth adicionales.

## 5. Decisiones de arquitectura

### 5.1 Base y acceso

- El destino es el proyecto Supabase `abazmhlhnccdfjwmojvs`.
- Supabase Postgres almacena todos los datos persistentes.
- El código de Circle usa `@supabase/ssr` para sesiones basadas en cookies y `@supabase/supabase-js` como cliente subyacente.
- Server Components realizan lecturas iniciales en el servidor.
- Las mutaciones se concentran en Route Handlers o Server Actions con validación de entrada.
- El navegador recibe únicamente la URL del proyecto y una publishable key.
- La secret key o `service_role` se limita a tareas administrativas server-only: provisión controlada, importación y mantenimiento. Nunca se usa para consultas normales de usuario ni se expone mediante variables `NEXT_PUBLIC_*`.

### 5.2 Workspaces privados

Cada identidad autorizada tiene:

- Una fila en `profiles` vinculada a `auth.users.id`.
- Un workspace privado.
- Una membresía con rol `owner`.

Todas las entidades funcionales llevan `workspace_id`. La autorización se basa en una membresía activa del usuario autenticado en ese workspace.

No se modela propiedad directa mediante `owner_id` en cada recurso y no se crean esquemas Postgres separados. Esto conserva una frontera uniforme, encaja con las rutas `/:orgId/...` y permite extender el producto sin duplicar el modelo.

### 5.3 Separación de responsabilidades

```text
Supabase Auth
      │
      ▼
sesión SSR y autorización
      │
      ▼
repositorios de dominio
      │
      ▼
Supabase Postgres + RLS
      │
      ▼
modelos de presentación de Circle
      │
      ▼
componentes y stores efímeros
```

- Los repositorios conocen SQL/Supabase y devuelven entidades de dominio.
- Los adaptadores convierten entidades de dominio a los objetos de presentación que necesita Circle.
- Los componentes no importan datos desde `mock-data` una vez migrado su dominio.
- Zustand conserva filtros, paneles, preferencias y estado optimista, pero no actúa como fuente canónica de proyectos o issues.

## 6. Autenticación

### 6.1 Proveedores

- Google OAuth para la cuenta Google.
- Azure/Microsoft OAuth para la cuenta Hotmail.
- La aplicación de Microsoft se registra para cuentas personales y utiliza el tenant `https://login.microsoftonline.com/consumers`.
- Azure solicita al menos el scope `email`, requerido por Supabase para identificar la cuenta.
- Los callbacks de ambos proveedores apuntan a `https://abazmhlhnccdfjwmojvs.supabase.co/auth/v1/callback`.
- Desarrollo y producción usan redirect URLs explícitamente permitidas. Desarrollo usa `localhost`, no `127.0.0.1`, para el flujo de Microsoft.

### 6.2 Allowlist

Solo dos direcciones pueden entrar a Circle. Las direcciones concretas son configuración operacional y no se versionan en el repositorio.

- Una tabla privada `private.allowed_accounts` contiene el email normalizado, tipo de workspace (`work` o `freelance`) y estado.
- La tabla no se expone mediante Data API.
- Después del callback OAuth, el servidor verifica el email contra esta allowlist antes de provisionar perfil o workspace.
- Una identidad autenticada pero no autorizada se desconecta y no recibe ninguna membresía.
- Todas las políticas de datos exigen membresía; por lo tanto, una cuenta no autorizada no obtiene acceso aunque exista accidentalmente en `auth.users`.

### 6.3 Provisión

La provisión es idempotente y transaccional:

1. Normalizar y validar el email autenticado.
2. Comprobar la allowlist server-side.
3. Crear o actualizar `profiles`.
4. Crear exactamente un workspace para el tipo configurado.
5. Crear la membresía `owner` si no existe.
6. Redirigir al slug del workspace.

Reintentar el callback no crea workspaces o membresías duplicadas.

### 6.4 Navegación protegida

- Las rutas privadas requieren sesión válida.
- El slug de URL se resuelve a un workspace al que pertenece el usuario.
- Intentar abrir el workspace de la otra cuenta devuelve `404`, evitando revelar su existencia.
- Una sesión vencida redirige a login conservando un destino interno validado.

## 7. Modelo de datos destino

### 7.1 Identidad y tenancy

#### `profiles`

- `id uuid primary key references auth.users(id)`
- `email text not null`
- `display_name text`
- `avatar_url text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

#### `workspaces`

- `id uuid primary key`
- `slug text unique not null`
- `name text not null`
- `kind text check (kind in ('work', 'freelance'))`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

#### `workspace_members`

- `workspace_id uuid references workspaces(id)`
- `user_id uuid references profiles(id)`
- `role text check (role in ('owner'))`
- `created_at timestamptz not null`
- Primary key compuesta `(workspace_id, user_id)`.

### 7.2 Equipos

#### `teams`

- `id uuid primary key`
- `workspace_id uuid not null`
- `key text not null`
- `name text not null`
- `color text`
- `icon text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- Unique `(workspace_id, key)`.

El workspace de trabajo recibe inicialmente los equipos `DESIGN` y `JB`. El workspace freelance recibe un equipo `FREELANCE` vacío.

### 7.3 Estados

#### `issue_statuses`

- `id uuid primary key`
- `workspace_id uuid not null`
- `team_id uuid`
- `key text not null`
- `name text not null`
- `category text check (category in ('triage','backlog','unstarted','started','completed','canceled'))`
- `color text not null`
- `position integer not null`
- Unique `(workspace_id, team_id, key)`.

Estados de arranque del workspace de trabajo:

| Estado TaskOS | Key Circle | Nombre | Categoría |
|---|---|---|---|
| `Entregado` | `done` | Entregado | `completed` |
| `Done` | `done` | Entregado | `completed` |
| `Not started` | `todo` | Por hacer | `unstarted` |
| `In progress` | `in-progress` | En progreso | `started` |
| `Post producción` | `post-production` | Post producción | `started` |
| `Cambios / actualización` | `changes` | Cambios / actualización | `started` |
| `Solicitudes` | `requests` | Solicitudes | `triage` |
| `En espera` | `waiting` | En espera | `started` |

La importación conserva el valor original en `issues.legacy_status` para auditoría.

### 7.4 Proyectos

#### `projects`

- `id uuid primary key`
- `workspace_id uuid not null`
- `team_id uuid not null`
- `name text not null`
- `status text not null`
- `priority text`
- `eng_hours double precision`
- `domain text check (domain in ('design','job_board','general'))`
- `platforms jsonb`
- `start_date date`
- `target_date date`
- `lead_user_id uuid`
- `health text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Los campos nuevos de Circle permanecen nulos hasta que el usuario los complete. No se inventan lead, fechas, health ni progreso durante la migración.

### 7.5 Issues

#### `issues`

- `id uuid primary key`
- `workspace_id uuid not null`
- `team_id uuid not null`
- `project_id uuid`
- `parent_id uuid`
- `status_id uuid not null`
- `identifier text not null`
- `title text not null`
- `description text`
- `priority text`
- `rank text not null`
- `due_date date`
- `assignee_user_id uuid`
- `domain text check (domain in ('design','job_board','general'))`
- `clickup_url text`
- `portal_type text`
- `requester_id uuid`
- `requested_by_legacy text`
- `requested_at date`
- `started_at date`
- `delivered_at date`
- `platforms jsonb`
- `source_week text`
- `source_url text`
- `legacy_status text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- Unique `(workspace_id, identifier)`.

Se agregan uniques compuestos `(id, workspace_id)` en proyectos e issues para permitir foreign keys compuestas que impidan referencias entre workspaces.

### 7.6 Secuencias de identificadores

#### `issue_sequences`

- `workspace_id uuid`
- `team_id uuid`
- `next_value bigint not null`
- Primary key `(workspace_id, team_id)`.

Durante la importación:

- Diseño usa prefijo `DES`.
- Job Boards usa prefijo `JB`.
- Los números se asignan de forma determinista por `created_at`, luego `id`.
- El identificador queda persistido y nunca se recalcula.
- La secuencia se deja en el siguiente número disponible.

### 7.7 Solicitantes

#### `requesters`

- `id uuid primary key`
- `workspace_id uuid not null`
- `name text not null`
- `created_at timestamptz not null`
- Unique funcional por `(workspace_id, lower(name))`.

`tasks.requested_by` se resuelve contra esta tabla ignorando mayúsculas. Si no existe coincidencia, se conserva en `requested_by_legacy` y se crea el requester correspondiente.

### 7.8 Registros de tiempo

#### `time_entries`

- `id uuid primary key`
- `workspace_id uuid not null`
- `issue_id uuid not null`
- `project_id uuid not null`
- `stage text not null`
- `duration_minutes integer not null check (duration_minutes > 0)`
- `note text`
- `requested_at date`
- `delivered_at date`
- `searched_web boolean not null`
- `used_stock boolean not null`
- `adapted_resources boolean not null`
- `incomplete_resources boolean not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Las foreign keys compuestas `(issue_id, workspace_id)` y `(project_id, workspace_id)` impiden enlazar filas de distintos workspaces.

### 7.9 Labels

#### `labels`

- `id uuid primary key`
- `workspace_id uuid not null`
- `name text not null`
- `color text not null`
- Unique `(workspace_id, name)`.

#### `issue_labels`

- `workspace_id uuid not null`
- `issue_id uuid not null`
- `label_id uuid not null`
- Primary key `(issue_id, label_id)`.
- Foreign keys compuestas para garantizar pertenencia al mismo workspace.

Las labels se crean vacías; TaskOS no contiene datos equivalentes.

### 7.10 Funciones diferidas

Ciclos, iniciativas, documentos, vistas guardadas, reviews y notificaciones conservan mocks durante los primeros hitos. Cada dominio tendrá su propia migración posterior y no bloquea el corte de proyectos/issues.

## 8. Row Level Security

### 8.1 Principios

- RLS se habilita en todas las tablas del esquema expuesto `public`.
- No existe una política genérica `TO authenticated` sin predicado de pertenencia.
- Las políticas comparan el `workspace_id` de la fila con una membresía cuyo `user_id = (select auth.uid())`.
- `UPDATE` define tanto `USING` como `WITH CHECK`.
- Las vistas expuestas usan `security_invoker = true`.
- La autorización no usa `user_metadata`.
- No se crean funciones `SECURITY DEFINER` en `public`.
- Si una función administrativa privilegiada fuera imprescindible, vive en el esquema privado, fija un `search_path` seguro, valida identidad internamente y revoca `EXECUTE` de `PUBLIC`.

### 8.2 Políticas por tipo

- `profiles`: cada usuario puede leer y actualizar solo su perfil.
- `workspace_members`: cada usuario puede leer solo sus membresías; las altas administrativas ocurren durante provisión.
- `workspaces`: lectura permitida si existe membresía; escritura de atributos solo para rol `owner`.
- Tablas de dominio: CRUD permitido únicamente si existe membresía en el mismo `workspace_id`.
- `issue_sequences`: no se modifica directamente desde el cliente; la asignación ocurre mediante una operación server-side transaccional.
- `private.allowed_accounts`: sin acceso para `anon` ni `authenticated`.

### 8.3 Pruebas negativas obligatorias

Para cada tabla funcional se prueba:

1. La cuenta de trabajo puede operar sobre su workspace.
2. La cuenta freelance puede operar sobre el suyo.
3. Trabajo no puede seleccionar, insertar, actualizar ni borrar filas freelance.
4. Freelance no puede seleccionar, insertar, actualizar ni borrar filas de trabajo.
5. Cambiar manualmente `workspace_id` en un payload falla.
6. Una sesión anónima no obtiene filas.

## 9. Estrategia de migración

### 9.1 Preparación

1. Capturar desde Neon el esquema, constraints e índices reales.
2. Registrar conteos y métricas de referencia.
3. Crear las migraciones de Supabase mediante la CLI, sin inventar nombres manualmente.
4. Aplicar el esquema en un entorno de prueba del proyecto destino.
5. Ejecutar advisors de seguridad y rendimiento.
6. Provisionar las dos identidades y sus workspaces.

### 9.2 Staging

La carga no escribe directamente en las tablas finales. Usa tablas de staging en un esquema no expuesto:

- `staging.taskos_projects`
- `staging.taskos_tasks`
- `staging.taskos_time_entries`
- `staging.taskos_requesters`

Cada fila conserva el UUID y los valores de origen. La carga a staging es repetible: reemplaza el lote identificado por un `migration_run_id` sin duplicar datos finales.

### 9.3 Transformación

Una transacción de promoción:

1. Valida conteos y referencias del lote.
2. Resuelve el workspace de trabajo.
3. Crea equipos y estados semilla.
4. Inserta solicitantes.
5. Inserta proyectos conservando UUID.
6. Inserta issues conservando UUID y asignando estado, team, identifier y rank.
7. Resuelve `parent_id` después de insertar todas las issues.
8. Inserta registros de tiempo.
9. Ajusta secuencias de identificadores.
10. Registra resultados en `private.migration_runs`.

La promoción usa upsert por UUID y debe producir el mismo resultado si se repite con la misma fuente.

### 9.4 Conversión de orden

TaskOS usa `position integer`; Circle usa ranking textual.

- Las tareas se agrupan por equipo, proyecto y estado destino.
- Dentro de cada grupo se ordenan por `position`, `created_at` e `id`.
- Se generan ranks LexoRank espaciados en ese orden.
- El reorder posterior escribe nuevos ranks sin cambiar identificadores.

### 9.5 Corte

1. Anunciar una ventana corta sin escrituras en TaskOS.
2. Ejecutar una extracción final de Neon.
3. Repetir staging y promoción.
4. Verificar datos y recorridos de Circle.
5. Habilitar escrituras en Circle.
6. Mantener TaskOS/Neon en solo lectura durante la estabilización.

No habrá sincronización bidireccional después del corte. Si el corte falla, Circle vuelve a modo no editable y TaskOS continúa como fuente activa.

## 10. Integración progresiva en Circle

### Fase 1: infraestructura y autenticación

- Clientes Supabase para browser y server.
- Middleware de renovación de sesión.
- Login con Google y Microsoft.
- Callback, allowlist y provisión.
- Layout protegido y resolución de workspace.

### Fase 2: esquema y carga inicial

- Migraciones, constraints, índices y RLS.
- Script Neon → staging.
- Transformación al workspace de trabajo.
- Validaciones automatizadas y reporte de migración.

### Fase 3: lectura real

- Repositorios y tipos de dominio.
- Equipos, proyectos, issues, estados y detalle desde Supabase.
- Adaptadores temporales para componentes que aún esperan objetos de `mock-data`.
- Estados de carga, vacío y error.

### Fase 4: escrituras

- Crear, editar y borrar projects/issues.
- Cambio de estado, proyecto, prioridad y fechas.
- Reorder optimista con rollback de UI ante error.
- Creación y edición de subtareas.

### Fase 5: funciones TaskOS

- Campos diferenciados de Diseño y Job Boards.
- Solicitantes.
- Registros de tiempo y flags de recursos.
- Métricas equivalentes a TaskOS.
- Vínculos ClickUp y fuentes de Diseño.

### Fase 6: retiro de mocks

- Eliminar imports directos de mocks en dominios migrados.
- Mantener mocks únicamente en funcionalidades explícitamente diferidas.
- Retirar mutaciones persistentes de Zustand.
- Documentar qué pantallas siguen siendo demostrativas.

### Fase 7: corte definitivo

- Verificación end-to-end con las dos cuentas.
- Habilitar Circle como aplicación primaria.
- Mantener Neon archivado y accesible, sin borrarlo.

## 11. Manejo de errores

- `401`: sesión ausente o vencida; redirección a login.
- `404`: workspace o recurso inexistente/no accesible.
- `409`: conflicto de actualización o identificador duplicado.
- `422`: entrada inválida con errores por campo.
- `500/503`: error de infraestructura; mensaje recuperable y registro server-side sin secretos.
- Mutaciones optimistas restauran el estado anterior si Supabase rechaza la operación.
- La importación aborta la promoción completa ante conteos, referencias o casts inválidos.
- Los reportes de migración no incluyen connection strings, tokens ni datos sensibles de OAuth.

## 12. Verificación

### 12.1 Datos

Después de la promoción deben cumplirse:

- 18 proyectos importados.
- 371 issues importadas.
- 374 registros de tiempo importados.
- 14 solicitantes importados.
- 29 issues de Diseño y 342 de Job Boards.
- 7 relaciones padre-hijo válidas.
- 0 proyectos o issues fuera del workspace de trabajo.
- 0 filas importadas al workspace freelance.
- 0 foreign keys rotas.
- UUID de origen conservados.
- Identificadores Circle únicos.

Se comparan además las métricas históricas de horas y revisiones con TaskOS. Una diferencia distinta de cero bloquea el corte.

### 12.2 Aplicación

- Login Google exitoso.
- Login Microsoft/Hotmail exitoso.
- Logout y renovación de sesión.
- Redirect seguro después de autenticar.
- Listados de proyectos e issues.
- Detalle de issue.
- Crear, editar, borrar y reordenar.
- Subtareas.
- Campos de Diseño y Job Boards.
- Registros de tiempo y métricas.
- Estados de carga, vacío, red y permiso.

### 12.3 Seguridad

- Matriz completa de pruebas RLS descrita en §8.3.
- Advisors de Supabase sin hallazgos críticos.
- Ninguna secret key en bundles de cliente, logs o archivos versionados.
- Tablas privadas no disponibles por Data API.
- Tablas públicas con RLS habilitada y políticas explícitas.

### 12.4 Calidad

- TypeScript sin errores nuevos.
- Tests unitarios de mapeos, ranking y validadores.
- Tests de integración para repositorios y RLS.
- Tests end-to-end de auth y flujos críticos.
- Build de producción exitoso.

## 13. Rollback

Durante estabilización:

1. TaskOS/Neon permanece intacto.
2. Circle puede ponerse en modo solo lectura mediante configuración server-side.
3. Si aparece pérdida, corrupción o bloqueo de acceso, se deshabilitan escrituras de Circle.
4. Se vuelve temporalmente a TaskOS como aplicación operativa.
5. Se corrige y repite la carga completa desde Neon a un destino limpio o restaurado.

No se intenta fusionar escrituras divergentes entre ambas bases. La ventana de corte evita dos fuentes activas simultáneas.

## 14. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Fuga de datos entre cuentas | RLS, foreign keys compuestas y pruebas negativas por operación |
| Esquema Neon distinto de migraciones versionadas | Capturar y validar el esquema vivo antes de exportar |
| Pérdida de semántica al normalizar estados | Mapeo explícito y `legacy_status` |
| Campos Circle inexistentes en TaskOS | Mantenerlos nulos; no fabricar datos |
| Mocks profundamente acoplados a componentes | Adaptadores temporales y migración por dominio |
| Doble escritura durante el corte | Ventana sin escrituras y una sola fuente activa |
| Reorder inconsistente | Conversión determinista y tests de ranking |
| Registro OAuth de terceros | Allowlist, ausencia de membresía y RLS |
| Expiración del secreto OAuth Microsoft | Registrar fecha de expiración y rotarlo antes del vencimiento |
| Dependencia accidental de service role | Repositorios normales usan sesión del usuario; acceso privilegiado aislado |

## 15. Criterios de aceptación

La migración se considera completa cuando:

1. Ambas cuentas inician sesión con sus proveedores asignados.
2. Cada cuenta ve exclusivamente su workspace.
3. Los conteos y métricas importados coinciden exactamente con Neon.
4. Proyectos, issues, subtareas, estados, reorder y registros de tiempo funcionan sobre Supabase.
5. Diseño y Job Boards conservan sus campos y comportamientos diferenciados.
6. Las pruebas de RLS demuestran aislamiento total en todas las operaciones.
7. No existen secretos en el cliente ni tablas expuestas sin RLS.
8. Las pantallas migradas ya no importan datos desde `mock-data`.
9. Circle supera build, typecheck y la suite de pruebas definida.
10. El procedimiento de rollback fue documentado y ensayado sin borrar Neon.

## 16. Entregables de implementación

- Configuración Supabase local y remota versionable sin secretos.
- Migraciones SQL completas.
- Políticas RLS y pruebas de aislamiento.
- Integración SSR de Supabase Auth.
- Login Google y Microsoft.
- Provisión de perfiles y workspaces.
- Script idempotente de extracción, staging y promoción.
- Reporte automatizado de validación de datos.
- Repositorios y modelos de dominio de Circle.
- Migración progresiva de pantallas y stores.
- Tests unitarios, de integración y end-to-end.
- Runbook de corte y rollback.

