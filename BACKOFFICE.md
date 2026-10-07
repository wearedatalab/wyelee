# Wyelee — Back office (mini-CRM, tareas con aviso por correo e integraciones)

Documentación de operación del back office que acompaña al sitio de **Wyelee** (wyeleeassembly.com.au).
La especificación técnica completa (esquema, contrato de la API, comportamiento del panel) está en `BACKOFFICE-SPEC.md`; este documento explica **qué es, cómo se ejecuta, cómo se despliega y cómo se usa**.

---

## 1. Qué es

Un panel privado en `https://wyeleeassembly.com.au/crm` que:

1. **Recibe automáticamente** cada solicitud enviada desde los formularios del sitio (`/quote/` y `/contact/`), con las fotos que adjunte el cliente, y avisa por correo a los administradores.
2. **Organiza esas solicitudes en un pipeline** (Nuevo → Contactado → Cotizado → Agendado → Ganado / Perdido) con vista Kanban, tabla, ficha de cada lead, línea de tiempo, notas y estadísticas. Mide la promesa del sitio: *cotización en 24 h* (SLA).
3. **Tareas con recordatorio por correo**: "llamar a este cliente en 2 horas", "confirmar la visita mañana a las 9". El aviso llega al correo del responsable a la hora exacta, además de mostrarse en el panel.
4. **Integraciones sin tocar código**: IDs de Google Analytics 4, Google Tag Manager, Google Ads, Meta Pixel, TikTok, Microsoft Clarity y Hotjar, más cajas para pegar cualquier código de terceros (chat, reseñas, Calendly…). El sitio público los carga en tiempo de ejecución.
5. **Acceso solo por enlace mágico** enviado al correo (sin contraseñas).
6. **Anti-spam con Google reCAPTCHA v3** (invisible) en `/quote/` y `/contact/`: lo que parece bot se guarda **retenido como spam**, sin aviso por correo y fuera del pipeline, y se puede recuperar con un clic (§6.9).

Idioma: el panel está en **español y en inglés**, según la persona (Juan en español, Ken en inglés; §6.10). Los correos del sistema llegan en el idioma de quien los recibe. Todo lo que ve el cliente final (sitio, formularios, plantillas de WhatsApp/SMS/correo al cliente) está siempre en **inglés**.

---

## 2. Arquitectura: un solo origen

Todo vive en el mismo repositorio y en el mismo dominio. No hay subdominios ni servidores aparte.

| Ruta | Qué sirve | Quién la sirve |
|---|---|---|
| `/` y todas las páginas del sitio | Sitio estático (`index.html`, `/quote/`, `/contact/`, `css/`, `js/`, `img/`…) | En Vercel: el CDN directamente. En local: `server.js` |
| `/crm` y `/crm/*` | SPA del panel (`webui/index.html` con `<base href="/crm/">`) | Función `api/index.js` (Vercel) / `server.js` (local) |
| `/api/*` y `/crm/api/*` | API JSON (el prefijo `/crm` se quita antes de enrutar) | Ídem |
| `/crm/auth/verify?token=…` | Verificación del enlace mágico → cookie de sesión → `302 /crm` | Ídem |

```
wyelee/
├── index.html, quote/, contact/, …    sitio generado por `python _build.py` desde _src/  (NO editar a mano)
├── css/  js/  img/                    assets del sitio · js/site.js envía los formularios · js/analytics.js carga las etiquetas
├── lib/db.js                          capa BD: node:sqlite en local (data/wyelee-crm.db) · Turso/libSQL si hay TURSO_DATABASE_URL
├── lib/app.js                         handler HTTP (rutas, auth, leads, tareas, ajustes, cron) + ensureInit() (esquema y seed)
├── lib/email.js                       correos vía Resend: magic link, notificación de lead (fotos adjuntas), recordatorio de tarea
├── api/index.js                       entrada serverless para Vercel (envuelve lib/app.js)
├── server.js                          entrada local / host persistente (puerto 8834)
├── webui/                             panel: index.html, app.js, styles.css, assets/ (logo, isotipo, favicon)
├── vercel.json                        rewrites /crm* y /api* → api/index, cabeceras de seguridad, cron diario
├── package.json                       única dependencia: @libsql/client (solo se usa en producción)
├── _seed_demo.mjs                     datos de demostración para local (ver §9)
└── BACKOFFICE-SPEC.md                 contrato técnico
```

Stack: Node ≥ 22, sin frameworks (`node:http`, `node:crypto`, `node:sqlite`), frontend vanilla JS/CSS. En producción la base de datos es **Turso** (libSQL por HTTP, persistente entre invocaciones serverless); en local es un archivo SQLite que no requiere instalar nada.

Cómo se conecta el sitio con el panel:

- `js/site.js`: los formularios con `data-endpoint="/api/public/lead"` envían un JSON con los campos, la atribución (página, referrer, UTMs, `gclid`), el token de reCAPTCHA v3 (`recaptcha`, si hay clave de sitio; §6.9) y las fotos reducidas en el navegador (lado mayor 1600 px, JPEG 0.8, máximo 6). Si el endpoint falla (p. ej. en el preview de GitHub Pages, donde no hay API) el formulario cae al comportamiento anterior: abre WhatsApp con el resumen.
- `js/analytics.js`: en cada página, tras la primera interacción del visitante (o 4 s después de cargar), pide `/api/public/site-config` e inyecta las etiquetas y los fragmentos configurados en el panel. No se ejecuta en `localhost`, `127.0.0.1` ni `*.github.io`. Tras un envío exitoso, `js/site.js` redirige a la **página de gracias** `/thank-you/?s=quote|contact&k=<nonce>` (noindex, fuera del sitemap) y allí `js/analytics.js` dispara una sola vez por nonce los eventos de conversión (`dataLayer.push({event:'wyelee_lead', lead_source})` para GTM, `generate_lead` de GA4, conversión de Google Ads, `Lead` de Meta, `SubmitForm` de TikTok); GA4/Ads/GTM miden la conversión por esa URL. En GTM usa un activador «Evento personalizado» con nombre `wyelee_lead` (variable de capa de datos `lead_source` = quote | contact; `quote_wa` | `contact_wa` cuando el envío cayó a WhatsApp con `&via=wa`: el visitante aún debe pulsar enviar, así que conviene segmentarlos o excluirlos): se envía una sola vez por envío al cargar `/thank-you/`. Un activador «Página vista» sobre `/thank-you/` también funciona, pero cuenta recargas y visitas directas (si se usa, añadir la condición Page URL contiene `k=`). Si el servidor no responde, el envío cae a WhatsApp y la misma página muestra el botón «Open WhatsApp» (`&via=wa`).

---

## 3. Ejecutar en local

Requisitos: Node 22 o superior (trae `node:sqlite`), Python 3 solo si se va a regenerar el sitio.

```bash
cd wyelee
npm install          # instala @libsql/client (no se usa en local, pero Vercel lo necesita)
node server.js       # o: npm start   (npm run dev = con --watch)
```

- Sitio: <http://localhost:8834/> · Panel: <http://localhost:8834/crm>
- La base se crea sola en `data/wyelee-crm.db` (carpeta ignorada por git) con dos usuarios administradores: `ADMIN_EMAIL` (por defecto `juan.garcia@wearedatalab.co`) y `ADMIN_EMAIL_2` (por defecto `Kenleong23@wyeleeassembly.com.au`). 0 leads.
- **Login sin correo**: como no hay `RESEND_API_KEY`, al pedir el enlace en `/crm` el servidor lo imprime en la **consola** y además lo devuelve como `devLink` (solo fuera de producción), que el panel muestra como botón. Clic → dentro.
- Para ver el panel con contenido: `node _seed_demo.mjs` (ver §9).
- El servidor local sirve el sitio estático pero **no expone** `lib/`, `api/`, `webui/` (salvo bajo `/crm`), `data/`, `node_modules/`, archivos `_*`, `package*.json`, `vercel.json`, `server.js` ni `*.md`.
- Para probar el envío de correo en local basta con exportar `RESEND_API_KEY` (y `MAIL_FROM`) antes de arrancar.

Regenerar el sitio tras editar `_src/*.html` o `_build.py`: `python _build.py` y luego `python _check.py` (debe dar 0 flags).

---

## 4. Variables de entorno

| Variable | Obligatoria en producción | Valor / notas |
|---|---|---|
| `TURSO_DATABASE_URL` | Sí | `libsql://wyelee-crm-<org>.turso.io`. Si no existe, se usa SQLite local. |
| `TURSO_AUTH_TOKEN` | Sí | Token de la base Turso (§5.2). |
| `RESEND_API_KEY` | Sí (sin ella no salen correos: ni magic link, ni notificaciones, ni recordatorios) | `re_…` desde resend.com → API Keys. |
| `MAIL_FROM` | Recomendada | Remitente. Por defecto `Wyelee <onboarding@resend.dev>`, que **solo entrega al correo del dueño de la cuenta Resend**. Tras verificar el dominio (§5.3): `Wyelee <crm@wyeleeassembly.com.au>` (cualquier buzón del dominio sirve; no necesita existir). |
| `ADMIN_EMAIL` | Recomendada | Primer administrador (recibe magic link y notificaciones). Por defecto `juan.garcia@wearedatalab.co`. Se usa al crear la base (seed, idioma `es`) y para el idioma por defecto de los usuarios existentes (§6.10): ese correo queda en `es`, el resto en `en`. |
| `ADMIN_EMAIL_2` | Opcional | Segundo administrador ("Ken Leong"). Por defecto `Kenleong23@wyeleeassembly.com.au`. Solo en el seed (idioma `en`). |
| `CRON_SECRET` | Recomendada | Cadena aleatoria larga. Protege `GET /api/cron/tasks`; Vercel la envía sola como `Authorization: Bearer …` en sus crons cuando la variable existe en el proyecto. |
| `APP_URL` | Recomendada | `https://wyeleeassembly.com.au`. Base de los enlaces en los correos (magic link, "Abrir la ficha"). Si falta se deduce de las cabeceras `x-forwarded-*` (podría salir el alias `wyelee.vercel.app`). Su dominio también se acepta como origen válido de los tokens de reCAPTCHA. |
| `RECAPTCHA_SECRET` | Para activar el anti-spam | **Clave secreta** de reCAPTCHA v3 (google.com/recaptcha/admin). Solo aquí: nunca en el panel, en la BD, en el código ni en los logs. Sin ella el servidor no verifica (los leads entran como siempre). §6.9. |
| `RECAPTCHA_SITE_KEY` | Opcional | Clave de sitio (pública). Si existe, **manda sobre** la que se guarde en *Integraciones* (el campo del panel aparece deshabilitado). Lo normal es dejarla vacía y ponerla en el panel. |
| `RECAPTCHA_VERIFY_URL` | No (solo pruebas) | Por defecto `https://www.google.com/recaptcha/api/siteverify`. Existe solo para apuntar a un stub local en pruebas; **no definirla en Vercel**. |
| `RESEND_API_URL` | No (solo pruebas) | Por defecto `https://api.resend.com/emails`. Existe solo para apuntar a un stub local y ver los correos sin enviarlos (con `RESEND_API_KEY=re_stub`); **no definirla en Vercel**. |
| `PORT` | Solo local | Puerto del `server.js` (8834). |
| `SITE_DIR` | Solo local | Carpeta del sitio estático si no es la raíz del repo. |
| `NODE_ENV` / `VERCEL` | Automáticas | Con `VERCEL` o `NODE_ENV=production` la app se considera en producción: cookies `Secure`, sin `devLink`, HSTS. |

Generar un `CRON_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

---

## 5. Despliegue en Vercel (proyecto `wyelee`)

Contexto (de `_ENTREGA.md`): el sitio ya está en producción en el proyecto **`wyelee`** de la cuenta Vercel `jkdaustralia@gmail.com` (equipo "Wyelee", plan Hobby), conectado al fork **`github.com/jkdaustralia-hash/wyelee`**, rama `main`, **directorio raíz** (Root Directory vacío). Cada push a `main` de ese fork redespliega. Nuestro repo de trabajo es `wearedatalab/wyelee` (origin); el flujo es push a origin → "Sync fork" en el fork del cliente (o acceso de colaborador para hacer push directo) → Vercel despliega.

### 5.1 Qué detecta Vercel solo

- `api/index.js` → función serverless Node (runtime 22 por `engines` en `package.json`). `vercel.json` la configura con `includeFiles: "webui/**"` (para que el panel viaje dentro de la función) y `maxDuration: 15`.
- `vercel.json` → rewrites `/crm`, `/crm/(.*)` y `/api/(.*)` a `/api/index`; el resto de rutas las sirve el CDN como estático. Cabeceras: `nosniff`, `Referrer-Policy`, HSTS en todo; `X-Frame-Options: DENY` bajo `/crm`; caché larga para `img/`, `css/`, `js/`.
- `crons` → `GET /api/cron/tasks` a las `0 22 * * *` (22:00 UTC = 07:30 en Adelaide en horario estándar / 08:30 en horario de verano, de octubre a abril). El plan Hobby permite crons **una vez al día** y la hora exacta puede variar dentro de esa hora.
- `npm install` se ejecuta en el build (instala `@libsql/client`). No hay paso de build del sitio: los `index.html` ya están generados y versionados.

### 5.2 Base de datos Turso

Con la CLI (macOS/Linux: `curl -sSfL https://get.tur.so/install.sh | bash`; Windows: `irm get.tur.so/install.ps1 | iex` o WSL):

```bash
turso auth signup                      # o: turso auth login  (cuenta del cliente o de DataLab)
turso db create wyelee-crm             # si pide región, elegir la más cercana a Australia (Sydney si aparece; si no, Singapur/Tokio)
turso db show wyelee-crm --url         # → libsql://wyelee-crm-<org>.turso.io   = TURSO_DATABASE_URL
turso db tokens create wyelee-crm      # → token largo                         = TURSO_AUTH_TOKEN
```

O desde el panel web <https://app.turso.tech>: *Create Database* → nombre `wyelee-crm` → en la base, *Connect* muestra la URL y permite generar el token. El plan gratuito sobra para este uso.

No hay que crear tablas: `ensureInit()` ejecuta el esquema (`CREATE TABLE IF NOT EXISTS …`) y el seed de usuarios en el primer arranque de cada despliegue. Para inspeccionar datos: `turso db shell wyelee-crm` → `SELECT id,name,status,created_at FROM leads ORDER BY id DESC LIMIT 20;`.

### 5.3 Resend y verificación del dominio `wyeleeassembly.com.au`

1. Cuenta en <https://resend.com> (plan gratuito: 3.000 correos/mes, 100/día; suficiente). *API Keys* → crear una con permiso *Sending access* → `RESEND_API_KEY`.
2. Mientras el dominio no esté verificado, `MAIL_FROM` por defecto usa `onboarding@resend.dev`, que **solo puede entregar al correo con el que se registró la cuenta Resend**. Para que Ken (u otros) reciban magic links, notificaciones y recordatorios hay que verificar el dominio.
3. *Domains* → *Add Domain* → `wyeleeassembly.com.au` → región (elegir la más cercana; Tokio `ap-northeast-1` para Australia). Resend muestra los registros exactos; **copiar los valores tal cual aparecen** (el DKIM y el host del MX son propios de cada dominio/región). Son de este tipo:

| Tipo | Nombre (host) en GoDaddy | Valor | Prioridad | Para qué |
|---|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKB…` (largo, lo da Resend) | — | DKIM: firma de los correos |
| MX | `send` | `feedback-smtp.ap-northeast-1.amazonses.com` (según región) | 10 | Rebotes/quejas del subdominio de envío |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — | SPF del subdominio de envío |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | — | DMARC (recomendado; si ya existe uno para Zoho, no crear otro: editarlo) |

   Importante: Resend envía desde el subdominio `send.wyeleeassembly.com.au` (el `From` sigue siendo `@wyeleeassembly.com.au`). Por eso **no se tocan los MX ni el SPF del dominio raíz (`@`)**, que son de Zoho y sostienen el buzón `Kenleong23@wyeleeassembly.com.au`.
4. DNS en **GoDaddy** (cuenta del cliente): *Mi dominio* → *DNS* → *Agregar registro*. En GoDaddy el *Nombre* va **relativo** (`resend._domainkey`, `send`, `_dmarc`, no el dominio completo). **GoDaddy pide un código por SMS al teléfono del cliente (···392) en cada cambio**, así que conviene hacer los 3–4 registros en una misma sesión con el cliente al teléfono, o que él los cargue siguiendo esta tabla.
5. Volver a Resend → *Verify DNS Records*. Suele tardar minutos (hasta ~1 h). Estado *Verified* → poner `MAIL_FROM=Wyelee <crm@wyeleeassembly.com.au>` en Vercel y redesplegar.

### 5.4 Variables en Vercel

Proyecto `wyelee` → *Settings* → *Environment Variables* → añadir para **Production** (y Preview si se quiere probar en ramas):
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `RESEND_API_KEY`, `MAIL_FROM`, `ADMIN_EMAIL`, `ADMIN_EMAIL_2`, `CRON_SECRET`, `APP_URL`, `RECAPTCHA_SECRET` (y opcionalmente `RECAPTCHA_SITE_KEY`; ver §6.9 para el orden recomendado).

Las variables solo aplican a despliegues nuevos: tras guardarlas, *Deployments* → *Redeploy* del último.

### 5.5 Comprobación tras desplegar

```
GET  https://wyeleeassembly.com.au/crm                  → panel (pantalla de login)
GET  https://wyeleeassembly.com.au/crm/api/me           → 401 {"error":…}
GET  https://wyeleeassembly.com.au/api/public/site-config → JSON con enabled:false (hasta activar en Integraciones)
GET  https://wyeleeassembly.com.au/lib/app.js           → 404 (no se expone)
```

Luego: pedir el enlace en `/crm` con `ADMIN_EMAIL` → debe llegar el correo → entrar → enviar una prueba desde `/quote/` → el lead aparece en **Nuevo** y llega la notificación con las fotos. Vercel → *Logs* muestra errores de la función (`✗ POST /api/… → mensaje`).

Actualizaciones de código: editar en `wyelee/` → (si se tocó `_src/` o `_build.py`) `python _build.py` → commit y push a `wearedatalab/wyelee` → sincronizar el fork `jkdaustralia-hash/wyelee` → Vercel despliega solo. **Nunca editar a mano los `index.html` generados.**

---

## 6. Guía de uso para el cliente

### 6.1 Entrar

1. Abrir `https://wyeleeassembly.com.au/crm`.
2. Escribir el correo con el que está dado de alta → *Enviar enlace de acceso*.
3. Abrir el correo "Tu acceso al panel" (en inglés: "Your Wyelee panel sign-in link") y pulsar *Entrar al panel*. El enlace sirve **una sola vez** y caduca a los **15 minutos**; si caducó, el panel muestra "El enlace caducó o ya se usó": pedir otro.
4. La sesión dura **7 días** en ese navegador. *Cerrar sesión* en la barra superior.

Si el correo no está registrado el panel responde igual ("Revisa tu correo") pero no llega nada: un administrador debe crearlo en *Usuarios* (§6.7).

### 6.2 Pipeline (Kanban)

Seis columnas: **Nuevo → Contactado → Cotizado → Agendado → Ganado / Perdido**. Cada tarjeta muestra nombre, servicio, suburbio y código postal, fecha, responsable, origen (`quote` = formulario de cotización, `contact` = formulario de contacto, `manual` = creado a mano) y, si tiene una tarea pendiente, un reloj con la hora ("📞 hoy 15:00", en rojo si ya venció).

- **Arrastrar** una tarjeta a otra columna cambia el estado. Al soltar en *Perdido* se pide el motivo (No responde · Precio · Fuera de zona · No hay fecha disponible · Spam · Otro).
- **SLA de 24 h**: en *Nuevo*, cada tarjeta lleva un distintivo verde "Cotizar en Xh" mientras quedan horas, y rojo "Vencido +Xh" cuando la solicitud lleva más de 24 h sin cotizar. Al pasar a *Cotizado* por primera vez se registra la hora (`quoted_at`), que alimenta las métricas de tiempo medio a cotización y % de SLA cumplido.
- **+ Lead manual**: para solicitudes que llegan por teléfono o WhatsApp. Buscador por nombre, correo, móvil, suburbio.
- Cada columna carga de 10 en 10 (*ver más*).

### 6.3 Leads (tabla) y ficha

*Leads*: tabla paginada con filtros por estado, servicio y ciudad, y búsqueda. Clic en una fila → ficha. El filtro **Spam (n)**, separado de los estados, muestra solo los leads retenidos por reCAPTCHA con su motivo y puntuación (§6.9); el resto de la tabla, el Kanban y el contador del menú nunca los incluyen.

La **ficha** de un lead tiene:

- Cabecera con nombre, estado y SLA.
- **Acciones rápidas** con plantillas en inglés: **WhatsApp** (abre `wa.me/61…` con "Hi <name>, this is Wyelee about your assembly quote…"), **SMS**, **Llamar**, **Correo**.
- Datos de la cotización: servicio, artículos, condición (nuevo en caja / parcialmente armado / ya armado), días y franja, extras (retiro de embalaje, anclaje a pared, desarme de muebles viejos), notas, ubicación. Se editan **en línea** (clic en el valor).
- **Galería de fotos** que envió el cliente (clic → grande). Las fotos solo se ven con sesión iniciada.
- Atribución: página desde la que envió, referencia, UTMs y `gclid` (permite saber si vino de Google Ads, Facebook, orgánico…).
- Control de estado (selector + motivo de pérdida), responsable, **tareas** (§6.4), **línea de tiempo** (creación, cambios de estado, notas, tareas) y campo para nueva nota.
- *Eliminar* (solo administradores; borra también eventos y fotos).
- *Marcar como spam* (cualquier usuario): lo retira del pipeline y de las estadísticas sin borrarlo (queda en *Leads → Spam*). Si el lead está retenido como spam, la ficha muestra arriba el aviso **"Retenido como spam por reCAPTCHA — <motivo>"** con los botones *No es spam* y, para administradores, *Eliminar*.

### 6.4 Tareas y avisos (recordatorios por correo)

Sirven para no olvidar seguimientos: "llamar en 2 horas", "confirmar visita mañana 9:00", "volver a escribir en 3 días".

**Crear una tarea** desde la ficha del lead, tarjeta *Tareas*: atajos (*Llamar en 1 h*, *Llamar en 3 h*, *Mañana 9:00*, *En 3 días*) o formulario con título, fecha/hora y responsable (un usuario concreto o "cualquiera").

**Cómo llega el aviso** — hay tres capas, para que el recordatorio llegue sí o sí:

1. **Correo a la hora exacta.** Al crear la tarea, el servidor programa en Resend un correo "⏰ Recordatorio: <tarea> — <lead>" para la fecha/hora de vencimiento (`scheduled_at`). Destinatario: el **responsable** de la tarea; si es "cualquiera", **todos los administradores activos** (cada uno en su idioma: un correo programado por idioma, §6.10). El correo lleva la tarea, los datos del lead (móvil y correo como enlaces), la hora en horario de Adelaide y el botón *Abrir la ficha*. Al marcar la tarea como hecha antes de la hora, o al cambiarle fecha/responsable, el correo programado se cancela (y se reprograma si procede). Resend solo permite programar hasta ~30 días; más allá actúa la capa 2.
2. **Respaldo automático.** Cada vez que alguien tiene el panel abierto (consulta cada 60 s) y una vez al día con el cron de Vercel (07:30/08:30 Adelaide), el servidor envía por correo cualquier tarea abierta ya vencida que todavía no tuviera correo enviado. Así el aviso llega aunque la programación hubiera fallado o la tarea se hubiera creado sin `RESEND_API_KEY`.
3. **En el panel.** Al vencer, aparece un aviso fijo en la esquina inferior derecha ("⏰ <tarea> — <lead>", con *Ver lead* y *Hecha*) que no desaparece solo; el título de la pestaña pasa a "(n) Wyelee CRM"; el menú *Tareas* muestra un contador (vencidas + de hoy). Con el botón *Activar avisos del navegador* (vista *Tareas*) también salta una notificación del sistema operativo.

Requisitos para que el correo llegue: `RESEND_API_KEY` configurada, `MAIL_FROM` con el dominio verificado (§5.3) y que el responsable tenga su correo real en *Usuarios*.

**Vista *Tareas***: mis tareas abiertas agrupadas en *Vencidas / Hoy / Próximas*, cada una con enlace al lead, botones *Hecha* y *Ver lead*; conmutador *todas / mías*; pestaña *Hechas*.

### 6.5 Estadísticas

KPIs (leads totales, nuevos este mes, ganados, tasa de cierre, tiempo medio a cotización, % SLA 24 h cumplido, vencidos), evolución mensual (creados / ganados / perdidos, últimos 6 meses), conversión por mes, por servicio, por ciudad y motivos de pérdida. Filtro por mes.

### 6.6 Integraciones (etiquetas y código de terceros)

Página solo para administradores. Todo lo que se guarda aquí lo lee el sitio público en `/api/public/site-config` **sin tocar código ni redesplegar**.

1. **Interruptor maestro** "Etiquetas activas en el sitio". Apagado (por defecto) = no se carga nada. Las etiquetas nunca se disparan en `localhost` ni en el preview de GitHub Pages.
2. **Tarjetas por proveedor**: Google Analytics 4 (`G-XXXXXXX`), Google Tag Manager (`GTM-XXXXXX`), Google Ads (`AW-XXXXXXXXX` + etiqueta de conversión, para registrar cada formulario enviado como conversión), Meta Pixel (número), TikTok Pixel, Microsoft Clarity, Hotjar (`hjid`). Con GTM, la conversión se crea con el activador «Evento personalizado» `wyelee_lead` (variable de capa de datos `lead_source` = quote | contact; `quote_wa` | `contact_wa` cuando el envío cayó a WhatsApp con `&via=wa`: el visitante aún debe pulsar enviar, así que conviene segmentarlos o excluirlos), que el sitio envía en `/thank-you/` una sola vez por envío; el activador «Página vista» sobre `/thank-you/` cuenta también recargas y visitas directas.
3. **Código incrustado**: tres cajas para pegar HTML/JS tal cual lo entrega el proveedor: *Inicio de `<head>`* (verificaciones de propiedad, scripts que deben cargar antes), *Inicio de `<body>`* (p. ej. el `<noscript>` de GTM), *Fin de `<body>`* (widgets de chat, reseñas, Calendly, botones flotantes).
4. **Fragmentos de terceros**: lista con nombre, posición, interruptor activo/inactivo y código. Permite tener varios códigos identificados y apagar uno sin borrarlo. Los `<script>` que contengan se ejecutan (el cargador los recrea al inyectarlos).
5. **Anti-spam de formularios**: tarjeta *reCAPTCHA v3 · anti-spam* con el estado (Activo / Falta `RECAPTCHA_SECRET` en Vercel / Sin clave de sitio), la clave de sitio, la puntuación mínima y dónde obtener las claves. No depende del interruptor maestro. Detalle en §6.9.
6. **Notificaciones**: `notify_emails` = correos extra (separados por coma) que también reciben el aviso de cada lead nuevo, además de los administradores; `whatsapp_number` = número que usan las acciones rápidas (por defecto `61432470313`).
7. *Guardar*. El panel lateral "Cómo funciona" muestra la URL del endpoint y el botón *Ver JSON público* para comprobar lo que el sitio recibirá.

Tiempos: el JSON se cachea (60 s en el navegador, 5 min en el CDN), y el sitio lo pide tras la primera interacción del visitante o 4 s tras cargar. Un cambio se ve en el sitio en pocos minutos. Para comprobar una etiqueta: abrir el sitio real, hacer clic en cualquier sitio y mirar en la consola/Network o con la extensión Tag Assistant.

### 6.7 Usuarios

Solo administradores. *Usuarios* → *Nuevo*: nombre, correo, rol e idioma (inglés por defecto; §6.10).

- **Administrador**: todo, incluidos usuarios, redirecciones, integraciones y borrar leads. Recibe las notificaciones de leads nuevos y los recordatorios de tareas sin responsable.
- **Comercial**: pipeline, leads, tareas y estadísticas.

La persona entra pidiendo su enlace mágico con ese correo (no hay contraseñas que comunicar). *Desactivar* corta el acceso al instante (las sesiones abiertas dejan de valer). *Entrar como* permite a un administrador ver el panel tal como lo ve otro usuario (para ayudarle); arriba aparece un aviso y un botón para volver.

### 6.8 Redirecciones

Para URLs antiguas o campañas: origen (`/ruta-vieja`) → destino (`/quote/` o URL completa), código 301/302, activar/desactivar, contador de usos. No afectan a `/crm`, `/api` ni a los assets.

### 6.9 Anti-spam: Google reCAPTCHA v3

**Qué hace.** reCAPTCHA v3 es invisible: no pide casillas ni acertijos. Al enviar `/quote/` o `/contact/`, el navegador pide a Google un token para la acción `quote` o `contact` y lo manda con el formulario (`recaptcha`). El servidor lo verifica con Google (`siteverify`, 4 s máximo) y Google devuelve una **puntuación de 0.0 (bot) a 1.0 (humano)**. El campo trampa `website` sigue funcionando como antes (descarta sin guardar).

**Qué pasa con cada envío** (el visitante recibe siempre la misma respuesta `201 {ok:true,id}` y va a `/thank-you/`; un bot no puede saber si lo detectamos):

| Resultado | Qué hace el servidor | Se ve en el lead (`attribution.recaptcha.verdict`) |
|---|---|---|
| Puntuación ≥ umbral, acción y dominio correctos | Lead normal: pipeline + aviso por correo | `ok` + puntuación |
| Sin token, token inválido/caducado/reutilizado, acción que no es la del formulario, dominio que no es `wyeleeassembly.com.au` / `www.` / `wyelee.vercel.app` (o el de `APP_URL`), sin puntuación, o **puntuación < umbral** | **Retenido como spam**: se guarda completo (con fotos) con `spam=1`, motivo (`no token`, `invalid token`, `action mismatch`, `hostname mismatch`, `no score`, `score 0.1`…) y puntuación. **Sin correo**, fuera del Kanban, de la tabla, de las estadísticas, del SLA, de los contadores y de los avisos de tareas | `spam` |
| Google no responde (caída, timeout de 4 s, error HTTP) o rechaza **nuestro** secreto (`invalid-input-secret`) | **Se acepta como lead normal** (fail-open: una caída de Google nunca hace perder clientes reales). Queda en el log de Vercel. Con cupo: como mucho **3 por IP y 30 en total por hora** (tabla `rate_hits`); pasado el cupo se retiene con motivo `unverified limit` ("Sin verificar (cupo)"), así un bot que coincida con una caída no inunda el pipeline | `unverified` (o `spam` si agotó el cupo) |
| Sin `RECAPTCHA_SECRET`, o con secreto pero sin clave de sitio | Igual que antes de existir el anti-spam (no se verifica nada) | `off` |

La ficha de cada lead muestra el resultado en *Origen y atribución* → *reCAPTCHA* (Humano · puntuación 0.9 / Retenido como spam / Sin verificar / Desactivado).

**Puesta en marcha** (en este orden, para no retener leads reales por el camino):

1. <https://www.google.com/recaptcha/admin> con la cuenta **wyeleeassembly@gmail.com** → *Crear* → tipo **Basado en puntuación (v3)** → dominios `wyeleeassembly.com.au` y `wyelee.vercel.app` (Google acepta los subdominios, `www.` incluido). Google da dos claves.
2. **Clave de sitio** (pública) → panel → *Integraciones* → *reCAPTCHA v3 · anti-spam* → *Guardar*. El estado pasa a "Falta RECAPTCHA_SECRET en Vercel": el sitio ya pide tokens (el JSON público se cachea hasta 5 min), pero todavía no se verifica nada.
3. **Clave secreta** → Vercel → proyecto `wyelee` → *Settings* → *Environment Variables* → `RECAPTCHA_SECRET` (Production) → *Redeploy*. Solo ahí: nunca en el panel, en el código, por correo ni en un chat. El estado pasa a **Activo**.
4. Probar: enviar `/quote/` desde el dominio real → el lead llega a *Nuevo* y su ficha muestra *reCAPTCHA: Humano · puntuación 0.9* (o similar).

Si el secreto está en Vercel pero falta la clave de sitio, el servidor deja la verificación **en pausa** (si no, todos los leads llegarían sin token y quedarían retenidos) y lo avisa en el log y en la tarjeta de *Integraciones*.

**Recuperar un falso positivo.** *Leads* → filtro **Spam (n)** → abrir el lead → **No es spam**. Vuelve al pipeline en el estado que tenía, queda un evento en la línea de tiempo ("Marcado como NO spam…", con quién y el motivo original) y en ese momento sale el **aviso por correo de nuevo lead**, como si acabara de llegar. Lo pueden hacer administradores y comerciales; *Eliminar* sigue siendo solo de administradores. Al revés, *Marcar como spam* en cualquier ficha lo retira sin enviar nada (motivo `manual`).

**Ajustar el umbral** (*Integraciones* → *Puntuación mínima*, 0.1–0.9, por defecto **0.5**, que es el valor que recomienda Google para empezar). Revisar *Leads → Spam* las primeras semanas:
- Si aparecen clientes reales retenidos por **puntuación** (motivo "Puntuación baja"), bajar a 0.3–0.4.
- Si entran bots en el pipeline con puntuación alta, subir a 0.6–0.7.
- Los retenidos por **sin token / token inválido** no dependen del umbral: casi siempre son bots que envían directo al servidor. Un cliente real solo llega así si su navegador bloqueó el script de Google; por eso conviene mirar la carpeta Spam de vez en cuando.
- La consola de reCAPTCHA de Google muestra la distribución de puntuaciones del sitio tras unos días de tráfico.

Los leads retenidos no caducan: se acumulan en *Spam* hasta que un administrador los elimine.

### 6.10 Idioma del panel / Panel language

El panel funciona en **español** y en **inglés**. El idioma es **de cada persona** (columna `users.lang`, `es` | `en`), no del navegador ni de la instalación.

- **Por defecto**: el administrador principal (`ADMIN_EMAIL`, Juan) en español; Ken y cualquier otro usuario existente en inglés. Los usuarios nuevos se crean en inglés salvo que se elija otro idioma en *Usuarios* (un administrador puede cambiar el de cualquiera).
- **Cambiar el idioma**: conmutador **ES | EN** en la barra lateral, junto al nombre. Se guarda en la cuenta (`PATCH /api/me {lang}`), así que se mantiene en cualquier navegador o dispositivo. En la pantalla de entrada (sin sesión) hay el mismo conmutador; ahí se usa la última elección de ese navegador o, si no hay, el idioma del navegador (español si empieza por `es`, si no inglés). Al entrar manda el idioma guardado en la cuenta.
- **«Entrar como»**: el idioma es el del administrador que entró, no el del usuario suplantado; cambiarlo mientras se ayuda a alguien no toca el idioma (ni los correos) de esa persona.
- **Correos del sistema en el idioma de quien los recibe**: el enlace de acceso, en el idioma de ese usuario; el recordatorio de tarea, en el del responsable (sin responsable: a cada administrador en el suyo); el aviso de nuevo lead y el de «recuperado de spam», un correo por idioma (los administradores se agrupan por su idioma; los correos extra de *Integraciones → Notificaciones* que no son usuarios del panel, en inglés). Fechas en horario de Adelaide con formato `es-CO` o `en-AU`. Quién recibe qué no cambia: solo el idioma. Los datos del cliente (nombre, artículos, notas) nunca se traducen.
- **Lo que no cambia de idioma**: el sitio y todo lo que ve el cliente final (formularios, mensajes de error de `/api/public/*`, plantillas de WhatsApp/SMS/correo de las acciones rápidas) siguen siempre en inglés. Las notas que escribe el equipo se muestran tal cual se escribieron.
- **Línea de tiempo**: las notas automáticas (lead recibido, creado a mano, tarea creada/hecha/reabierta, spam) se guardan en español como siempre y, desde esta versión, con sus datos en `lead_events.meta`; en inglés se muestran traducidas (las antiguas, sin `meta`, se traducen por patrón).
- **Técnico**: el panel envía la cabecera `X-Wy-Lang: es|en` en cada llamada; el servidor responde los errores en ese idioma (si falta: el del usuario; sin sesión: español) con la forma `{ error: "<texto>", code: "<clave estable>" }`. `GET /api/meta` mantiene las etiquetas en español y añade `statusLabelsI18n`, `lossReasonsI18n`, `roleLabelsI18n` y `sourceLabelsI18n` con `{ es, en }`. La migración es automática al arrancar (`ALTER TABLE users ADD COLUMN lang`, `ALTER TABLE lead_events ADD COLUMN meta` + relleno idempotente de `lang`).

---

## 7. Seguridad

- **Sin contraseñas.** Acceso por enlace mágico: token aleatorio (`crypto.randomBytes`), **un solo uso**, caduca a los **15 minutos**, se guarda en `magic_tokens` y se marca `used`. La respuesta de `POST /api/auth/request` es siempre la misma exista o no el correo (sin enumeración de usuarios); en producción nunca devuelve el enlace.
- **Sesiones** de **7 días** en cookie `wy_sid`: `HttpOnly`, `SameSite=Lax`, `Secure` en producción, `Path=/`. Se validan contra la tabla `sessions` en cada petición; desactivar un usuario invalida su acceso.
- **Rate limit por IP** persistido en BD (funciona entre invocaciones serverless): `POST /api/public/lead` 20/hora, `POST /api/auth/request` 6 cada 15 min → `429`.
- **Honeypot** en los formularios (campo oculto `website`): si viene relleno se responde `201 {ok:true}` sin guardar nada. Además validación estricta de cada campo (formato de correo, código postal de 4 dígitos, listas cerradas de servicio/condición/días/franja/extras, topes de longitud) y de las fotos (máximo 6, ≤ 700 000 caracteres base64 cada una, solo JPEG/PNG/WebP; cuerpo total ≤ 4,5 MB).
- **reCAPTCHA v3** (§6.9): verificación en el servidor contra Google con `RECAPTCHA_SECRET` (solo variable de entorno; la API nunca la devuelve —`GET /api/settings` solo dice `recaptcha_secret_configured: true|false`— ni se escribe en logs), comprobando acción y dominio además de la puntuación. Lo sospechoso se guarda retenido (sin correo) con la misma respuesta que un lead real; si Google no responde se acepta (fail-open) con un cupo de 3 por IP y 30 en total por hora. Si alguien pega el secreto en el campo de la clave de sitio, `PUT /api/settings` lo rechaza (400) y nunca se publica en `/api/public/site-config`.
- **Autorización por rol**: `comercial` no puede borrar leads ni ver/editar usuarios, redirecciones o integraciones; `401` sin sesión, `403` sin permiso.
- **Fotos** solo accesibles con sesión (`/api/leads/:id/files/:fid`, `Cache-Control: private`).
- **Cabeceras**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` en `/crm`, HSTS en producción. CORS `*` únicamente en las rutas públicas (`/api/public/*`).
- **Cron** `GET /api/cron/tasks` exige `Authorization: Bearer ${CRON_SECRET}` cuando la variable existe (Vercel la envía automáticamente).
- **Secretos** solo en variables de entorno; nada en el código ni en el repo (`data/`, `.env`, `.vercel/` están en `.gitignore`). La base local `data/wyelee-crm.db` contiene datos personales: no compartirla.
- Los HTML/JS que se pegan en *Integraciones* se inyectan tal cual en el sitio público: **solo administradores** pueden editarlos y solo se debe pegar código de proveedores de confianza.
- Datos personales de clientes (nombre, contacto, dirección, fotos): conviene publicar una política de privacidad en el sitio (pendiente en `_ENTREGA.md`) y borrar leads que lo soliciten (*Eliminar* en la ficha).

---

## 8. Referencia rápida de la API

Todas las respuestas son JSON. Base: `/api/…` (también `/crm/api/…`). Autenticación por cookie `wy_sid`. Rol mínimo: **P** = pública, **S** = con sesión, **A** = administrador. Errores del panel: `{ error, code }` con `error` en el idioma de la cabecera `X-Wy-Lang` (o del usuario; §6.10); las rutas **P** del sitio responden en inglés.

| Método y ruta | Rol | Descripción |
|---|---|---|
| `GET /api/public/site-config` | P | Config de etiquetas para el sitio (`enabled`, IDs, `custom_*`, `snippets` activos) + `recaptcha_site_key` (clave efectiva: env `RECAPTCHA_SITE_KEY` o ajuste; se publica aunque `enabled` sea `false`). Cache 60 s / 5 min. |
| `POST /api/public/lead` | P | Intake de formularios. Body `{ source, name, email, mobile, suburb, postcode, city, service, items, condition, days, time, addons, notes|message, contact, photos:[{name,type,data}], attribution, website, recaptcha }` → `201 { ok, id }` (también cuando queda retenido como spam). `recaptcha` = token v3 con acción = `source`. Guarda `spam`, `spam_reason`, `recaptcha_score` y `attribution.recaptcha = { verdict: ok|spam|unverified|off, score, action }`. |
| `POST /api/auth/request` | P | `{ email }` → siempre `200 { ok:true }` (+ `devLink` solo en local). |
| `GET /crm/auth/verify?token=` | P | Valida el enlace → cookie → `302 /crm` (`302 /crm#expired` si no vale). |
| `POST /api/auth/logout` · `GET /api/me` · `POST /api/auth/stop-impersonate` | S | Sesión actual `{ id, name, email, role, lang, impersonating }` (`lang` = idioma de la persona; en «Entrar como», el del administrador). |
| `PATCH /api/me` | S | `{ lang: 'es'|'en' }` guarda el idioma propio (panel + correos que recibe) → misma respuesta que `GET /api/me`; otro valor → `400 invalid_lang`. |
| `GET /api/meta` | S | Constantes: estados, etiquetas, motivos, servicios, condiciones, extras, roles, `slaHours` (etiquetas en español, como siempre) + `langs`, `statusLabelsI18n`, `lossReasonsI18n`, `roleLabelsI18n`, `sourceLabelsI18n` (`{ es:{…}, en:{…} }`). |
| `GET /api/leads?status=&q=&service=&city=&spam=` | S | `{ leads:[…], spamCount }`. `leads` (máx. 1000, `updated_at DESC`) con `owner_name`, `photos`, `hours_open`, `next_task`, `open_tasks`, `spam`, `spam_reason`, `recaptcha_score`; **excluye los retenidos como spam** salvo con `spam=1`, que devuelve solo esos. `spamCount` = total retenido. |
| `POST /api/leads` | S | Lead manual (`source:'manual'`). |
| `GET /api/leads/:id` | S | Ficha + `events[]` + `files[]` (sin binario). |
| `GET /api/leads/:id/files/:fid` | S | Imagen (binario, `Content-Type` = mime). |
| `PATCH /api/leads/:id` | S | Edita name, email, mobile, suburb, postcode, city, service, items, condition, days, time, addons, notes, owner_id. |
| `PATCH /api/leads/:id/status` | S | `{ status, loss_reason? }`; `perdido` exige motivo; primer `cotizado` fija `quoted_at`. |
| `PATCH /api/leads/:id/spam` | S | `{ spam:false }` = *No es spam*: vuelve al pipeline, evento `spam` y envía el aviso de nuevo lead en ese momento. `{ spam:true }` = lo retira (`spam_reason:'manual'`, sin correo). Responde el lead + `notification: sent|skipped|failed|none`. Sin cambio → no hace nada. |
| `POST /api/leads/:id/note` | S | `{ note }`. |
| `DELETE /api/leads/:id` | A | Borra lead, eventos, fotos y tareas. |
| `GET /api/tasks?scope=mine|all&state=open|done|all&lead_id=` | S | Tareas ordenadas por `due_at` con `lead_name`, `user_name`, `overdue`. Sin `lead_id` excluye las de leads retenidos como spam. |
| `GET /api/tasks/summary` | S | `{ overdue, dueSoon, today, due:[…] }`; las de `due` se marcan `notified` (se avisan una vez). Dispara el respaldo de correo. Ignora (y no avisa) las tareas de leads retenidos como spam. |
| `POST /api/leads/:id/tasks` | S | `{ title, due_at, user_id? }` → `201`; programa el correo en Resend. |
| `PATCH /api/tasks/:id` | S | `{ done?, title?, due_at?, user_id? }`; cancela/reprograma el correo. |
| `DELETE /api/tasks/:id` | S | Borra y cancela el correo programado. |
| `GET /api/cron/tasks` | Bearer `CRON_SECRET` | Envía por correo las tareas vencidas sin aviso (`emailed=0`). Vercel lo llama a diario. |
| `GET /api/users` · `POST /api/users` · `PATCH /api/users/:id` · `POST /api/users/:id/impersonate` | A | Gestión de usuarios y "Entrar como". Los usuarios incluyen `lang`; `POST` acepta `lang` (por defecto `en`) y `PATCH` lo cambia (`es`|`en`, otro valor → `400`). |
| `GET/POST /api/redirects` · `PATCH/DELETE /api/redirects/:id` | A | Redirecciones. |
| `GET /api/stats?month=YYYY-MM` | S | Embudo, KPIs (`avgHoursToQuote`, `slaRate`, `overdue`…), mensual, por servicio, por ciudad, motivos de pérdida. Todo **sin** los leads retenidos como spam; `spamCount` informativo. |
| `GET /api/settings` · `PUT /api/settings` | A | Claves permitidas: `tracking_enabled`, `ga4_id`, `gtm_id`, `google_ads_id`, `google_ads_label`, `meta_pixel_id`, `tiktok_pixel_id`, `clarity_id`, `hotjar_id`, `custom_head`, `custom_body_start`, `custom_body_end`, `snippets` (JSON), `notify_emails`, `whatsapp_number`, `recaptcha_site_key`, `recaptcha_min_score` (0.1–0.9, por defecto `0.5`). Ambas respuestas añaden, de solo lectura: `recaptcha_secret_configured` (bool), `recaptcha_key_source` (`env`\|`setting`\|`none`) y `recaptcha_site_key_effective`. El secreto nunca se devuelve. |

Ejemplo de intake (lo que envía `js/site.js`):

```bash
curl -X POST http://localhost:8834/api/public/lead -H "Content-Type: application/json" -d '{
  "source":"quote","name":"Jane Citizen","email":"jane@example.com","mobile":"0491 570 006",
  "suburb":"Norwood","postcode":"5067","city":"Adelaide","service":"furniture",
  "items":"2 x IKEA BILLY bookcase","condition":"new","days":"weekdays","time":"morning",
  "addons":["packaging"],"notes":"Ground floor","photos":[],
  "attribution":{"page":"/quote/","referrer":"https://www.google.com/","utm_source":"google","utm_medium":"cpc"}
}'
```

---

## 9. Datos de demostración (`_seed_demo.mjs`)

Script independiente del servidor que llena la base con ~13 leads realistas (suburbios y códigos postales reales de Adelaide, Sydney, Brisbane y Perth; servicios mezclados; estados repartidos por todo el pipeline con sus eventos coherentes; varias tareas, una ya vencida para ver el aviso) sin fotos. Los datos de los clientes son ficticios (correos `@example.com`, móviles del rango reservado por la ACMA para ficción `0491 57x xxx`).

```bash
node _seed_demo.mjs            # solo si la tabla leads está vacía
node _seed_demo.mjs --force    # borra leads, eventos, fotos y tareas y vuelve a sembrar
```

Si `TURSO_DATABASE_URL` está definida (base remota) el script se niega salvo que se añada `--remote`; **no usarlo en la base de producción del cliente**. Requiere que `lib/app.js` exista (usa su `ensureInit()` para crear el esquema y los usuarios). El archivo empieza por `_`, por lo que `.gitignore` lo excluye del repo salvo que se añada una excepción.

---

## 10. Problemas frecuentes

| Síntoma | Causa probable / solución |
|---|---|
| No llega el correo del enlace mágico | Sin `RESEND_API_KEY`; dominio no verificado y `MAIL_FROM` en `onboarding@resend.dev` (solo entrega al dueño de la cuenta Resend); correo no dado de alta en *Usuarios*; más de 6 peticiones en 15 min; carpeta de spam. En local, el enlace está en la consola. |
| El formulario del sitio abre WhatsApp en vez de enviar | El `fetch` a `/api/public/lead` falló: el sitio no se está viendo desde el dominio/servidor con API (p. ej. GitHub Pages o `python -m http.server`), o la función devolvió error (ver *Logs* en Vercel). Con el server local abrir `http://localhost:8834/quote/`. |
| Las etiquetas no se disparan | Interruptor maestro apagado; estás en `localhost`/`github.io`; caché de hasta 5 min; el cargador espera a la primera interacción o 4 s. Comprobar `/api/public/site-config`. |
| El recordatorio de una tarea no llegó a la hora | Ver §6.4: sin `RESEND_API_KEY` o con dominio sin verificar no se programa; el respaldo lo envía al abrir el panel o con el cron diario. Comprobar que el responsable tiene correo correcto. |
| `500` en todas las rutas de `/crm` | Variables de Turso mal puestas o token caducado; ver *Logs* de la función. Regenerar token con `turso db tokens create wyelee-crm`. |
| Se perdieron los datos al redesplegar | Solo pasa si no hay `TURSO_DATABASE_URL` (en Vercel el sistema de archivos es efímero). Configurar Turso (§5.2). |
| Todos los leads caen en *Leads → Spam* | Motivo **Token inválido**: la clave de sitio del panel y `RECAPTCHA_SECRET` no son pareja (de proyectos reCAPTCHA distintos) → copiar las dos del mismo. Motivo **Dominio no autorizado**: el sitio se usa desde un dominio que no está en el proyecto de Google ni en `APP_URL`. Motivo **Sin puntuación**: la clave creada es v2 (casilla), no v3 → crear una v3. Motivo **Sin token** en todos: el sitio no está cargando el script (revisar la clave en *Integraciones* y `/api/public/site-config`; tras guardar, el JSON tarda hasta 5 min en refrescarse). Recuperar los reales con *No es spam*. |
| Un lead real quedó retenido | Abrirlo en *Leads → Spam* → *No es spam* (vuelve al pipeline y sale el aviso). Si se repite con "Puntuación baja", bajar el umbral en *Integraciones* (§6.9). |
| Leads con *reCAPTCHA: Sin verificar* | Google no respondió en 4 s o rechazó el secreto (`invalid-input-secret` en *Logs* de Vercel → corregir `RECAPTCHA_SECRET` y redeploy; si el panel y Vercel tienen las claves intercambiadas, ponerlas bien y, como el secreto quedó público, regenerarlas en Google). Se aceptan para no perder clientes, con cupo (3 por IP y 30 en total por hora); los que lo superan quedan en *Spam* como "Sin verificar (cupo)". |
