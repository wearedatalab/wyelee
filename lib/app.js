// ============================================================
//  Wyelee — App handler (async, portable)
//  DB async (Turso libSQL en prod / node:sqlite en local) vía ./db.js
//  Sirve el sitio estático de esta carpeta en "/" y el back office en "/crm"
//  (un solo origen). Derivado de jkd-legacy-crm/lib/app.js (misma estructura y
//  endurecimiento), sin nada específico de JKD.
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as db from './db.js';
import { sendMagicLink, sendLeadNotification, sendTaskReminder, cancelScheduledEmail, adelaide } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(path.join(__dirname, '..'));               // …/wyelee (raíz del proyecto = sitio)
const WEBUI_DIR = path.join(ROOT, 'webui');                          // SPA del panel (bajo /crm)
const SITE_DIR = (process.env.SITE_DIR && fs.existsSync(process.env.SITE_DIR)) ? path.resolve(process.env.SITE_DIR) : ROOT;
const IS_PROD = !!(process.env.VERCEL || process.env.NODE_ENV === 'production');
const TZ = 'Australia/Adelaide';

// ---------------- Constants (única fuente en backend) ----------------
export const STATUSES = ['nuevo', 'contactado', 'cotizado', 'agendado', 'ganado', 'perdido'];
export const STATUS_LABELS = { nuevo: 'Nuevo', contactado: 'Contactado', cotizado: 'Cotizado', agendado: 'Agendado', ganado: 'Ganado', perdido: 'Perdido' };
export const LOSS_REASONS = { no_responde: 'No responde', precio: 'Precio', fuera_zona: 'Fuera de zona', fecha: 'No hay fecha disponible', spam: 'Spam', otro: 'Otro' };
export const SERVICES = { furniture: 'Furniture assembly', wardrobe: 'Wardrobe assembly', disassembly: 'Disassembly', kitchen: 'IKEA kitchen' };
export const CONDITIONS = { new: 'New in the box', partial: 'Partially assembled', assembled: 'Already assembled' };
export const ADDONS = { packaging: 'Packaging removal', anchoring: 'Wall anchoring', disassembly: 'Disassembly of old furniture' };
export const DAYS = { weekdays: 'Weekdays', weekend: 'Weekend', either: 'Either' };
export const TIMES = { morning: 'Morning', afternoon: 'Afternoon', either: 'Either' };
export const ROLES = ['admin', 'comercial'];
export const ROLE_LABELS = { admin: 'Administrador', comercial: 'Comercial' };
export const SLA_HOURS = 24;
const SOURCES = ['quote', 'contact', 'manual'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTOS = 6;
const MAX_PHOTO_B64 = 700000;
const DEFAULT_ADMIN_EMAIL = 'juan.garcia@wearedatalab.co';

// ---------------- Idioma del panel (es | en) ----------------
// Cada usuario tiene users.lang. Idioma de una petición del panel: cabecera X-Wy-Lang (si es válida) → lang del usuario
// (de la persona real si está en «Entrar como») → 'es'. Las rutas públicas del sitio (/api/public/*) responden en inglés.
// Los correos salen en el idioma del DESTINATARIO (ver notifyNewLead / scheduleTaskEmail / requestMagicLink).
export const LANGS = ['es', 'en'];
const normLang = (v) => { const s = String(v == null ? '' : v).trim().toLowerCase(); return LANGS.includes(s) ? s : null; };
const userLang = (u) => normLang(u && u.lang) || 'en';   // tras el backfill nunca es null; 'en' = idioma del negocio
export const STATUS_LABELS_I18N = { es: STATUS_LABELS, en: { nuevo: 'New', contactado: 'Contacted', cotizado: 'Quoted', agendado: 'Booked', ganado: 'Won', perdido: 'Lost' } };
export const LOSS_REASONS_I18N = { es: LOSS_REASONS, en: { no_responde: 'No response', precio: 'Price', fuera_zona: 'Outside service area', fecha: 'No available date', spam: 'Spam', otro: 'Other' } };
export const ROLE_LABELS_I18N = { es: ROLE_LABELS, en: { admin: 'Admin', comercial: 'Sales' } };
export const SOURCE_LABELS_I18N = { es: { quote: 'Cotización', contact: 'Contacto', manual: 'Manual' }, en: { quote: 'Quote form', contact: 'Contact form', manual: 'Manual' } };
// Mensajes de error/aviso que el panel puede mostrar. Las respuestas de error llevan { error: <texto en el idioma>, code: <clave> }.
const MSG = {
  es: {
    unauthorized: 'Sesión no válida o caducada. Vuelve a entrar.',
    forbidden: 'No tienes permiso para hacer esto',
    admin_only: 'Solo administradores',
    not_found: 'No encontrado',
    method: 'Método no permitido',
    no_route: 'Ruta no encontrada',
    bad_file: 'Archivo dañado',
    too_many_auth: 'Demasiados intentos. Espera unos minutos.',
    too_many_requests: 'Demasiadas solicitudes. Inténtalo más tarde.',
    too_large: 'Solicitud demasiado grande (máx. 4,5 MB). Envía menos fotos o más pequeñas.',
    invalid_email: 'Correo inválido',
    contact_required: 'Falta el móvil o el correo',
    postcode: 'El código postal debe tener 4 dígitos',
    invalid_owner: 'Responsable inválido',
    invalid_status: 'Estado inválido',
    loss_reason_required: 'Indica el motivo de pérdida',
    spam_required: 'spam requerido (true|false)',
    note_empty: 'La nota está vacía',
    title_required: 'Título requerido',
    due_invalid: 'Fecha de vencimiento inválida',
    date_invalid: 'Fecha inválida',
    name_email_required: 'Nombre y correo requeridos',
    name_required: 'Nombre requerido',
    email_taken: 'Ya existe un usuario con ese correo',
    self_demote: 'No puedes quitarte el rol de administrador',
    self_deactivate: 'No puedes desactivarte a ti mismo',
    self_impersonate: 'Ya eres tú',
    not_impersonating: 'No estás entrando como otro usuario',
    invalid_lang: 'Idioma inválido (es | en)',
    recaptcha_secret_in_site_key: 'Esa es la clave secreta de reCAPTCHA: va solo en Vercel (RECAPTCHA_SECRET). Aquí va la clave de sitio.',
    redirect_required: 'Origen y destino requeridos',
    redirect_from_forbidden: 'Origen no permitido (no uses /, /crm o /api)',
    redirect_same: 'El origen y el destino no pueden ser iguales',
    redirect_exists: 'Ya existe una redirección para ese origen',
    redirect_from_invalid: 'Origen no permitido',
    redirect_to_required: 'Destino requerido',
    no_service: 'Contacto (sin servicio)',
  },
  en: {
    unauthorized: 'Your session has expired or is not valid. Please sign in again.',
    forbidden: "You don't have permission to do this",
    admin_only: 'Admins only',
    not_found: 'Not found',
    method: 'Method not allowed',
    no_route: 'Route not found',
    bad_file: 'Corrupted file',
    too_many_auth: 'Too many attempts. Please wait a few minutes.',
    too_many_requests: 'Too many requests. Please try again later.',
    too_large: 'Request too large (max 4.5 MB). Please send fewer or smaller photos.',
    invalid_email: 'Invalid email address',
    contact_required: 'Mobile or email is required',
    postcode: 'Postcode must be 4 digits',
    invalid_owner: 'Invalid assignee',
    invalid_status: 'Invalid status',
    loss_reason_required: 'Choose a loss reason',
    spam_required: 'spam is required (true|false)',
    note_empty: 'The note is empty',
    title_required: 'Title is required',
    due_invalid: 'Invalid due date',
    date_invalid: 'Invalid date',
    name_email_required: 'Name and email are required',
    name_required: 'Name is required',
    email_taken: 'A user with that email already exists',
    self_demote: "You can't remove your own admin role",
    self_deactivate: "You can't deactivate yourself",
    self_impersonate: "That's already you",
    not_impersonating: "You're not signed in as another user",
    invalid_lang: 'Invalid language (es | en)',
    recaptcha_secret_in_site_key: "That's the reCAPTCHA secret key: it goes only in Vercel (RECAPTCHA_SECRET). Paste the site key here.",
    redirect_required: 'Source and destination are required',
    redirect_from_forbidden: 'Source not allowed (do not use /, /crm or /api)',
    redirect_same: 'Source and destination cannot be the same',
    redirect_exists: 'A redirect for that source already exists',
    redirect_from_invalid: 'Source not allowed',
    redirect_to_required: 'Destination is required',
    no_service: 'Contact (no service)',
  },
};
function tr(lang, key, vars) {
  const dict = MSG[normLang(lang) || 'es'];
  let s = dict[key] != null ? dict[key] : (MSG.es[key] != null ? MSG.es[key] : key);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  return s;
}

// ---------------- Helpers ----------------
const nowISO = () => new Date().toISOString();
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);
const addMinutes = (n) => new Date(Date.now() + n * 60000);
const token = (n = 24) => crypto.randomBytes(n).toString('hex');
const shortId = () => crypto.randomBytes(4).toString('hex');
const clean = (s) => (s == null ? null : String(s).trim() || null);
const cap = (s, n) => { const v = clean(s); return v == null ? null : v.slice(0, n); };
const toISO = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); };
const hoursBetween = (a, b) => Math.round(((new Date(b).getTime() - new Date(a).getTime()) / 36e5) * 10) / 10;
const fmtAdelaide = (iso) => adelaide(iso);

// Acepta la clave ('new') o la etiqueta ('New in the box', 'Already assembled — needs disassembly') → clave o null
function normKey(v, map) {
  const s = clean(v);
  if (!s) return null;
  if (Object.prototype.hasOwnProperty.call(map, s)) return s;
  const low = s.toLowerCase();
  for (const [k, label] of Object.entries(map)) {
    if (k.toLowerCase() === low || String(label).toLowerCase() === low) return k;
  }
  for (const [k, label] of Object.entries(map)) {
    if (low.startsWith(String(label).toLowerCase()) || String(label).toLowerCase().startsWith(low)) return k;
  }
  return null;
}
function normAddons(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [];
  for (const item of list) { const k = normKey(item, ADDONS); if (k && !out.includes(k)) out.push(k); }
  return out.length ? out.join(',') : null;
}
const labelsOf = (csv, map) => String(csv || '').split(',').map((k) => map[k.trim()] || k.trim()).filter(Boolean).join(', ');
function normMobile(m) {
  const s = clean(m);
  if (!s) return null;
  return s.replace(/[^\d+()\s-]/g, '').trim().slice(0, 40) || null;
}

function send(res, code, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(body);
}
const json = (res, code, data, headers) => send(res, code, data, headers);
// Error localizado: { error: texto en `lang`, code: clave estable (para que el panel no dependa del texto) }
const fail = (res, code, lang, key, vars) => json(res, code, { error: tr(lang, key, vars), code: key });

// CSP del panel: solo scripts propios (app.js, sin inline), estilos propios + Google Fonts (inline por los style="" del render),
// imágenes propias/data:, fetch solo al mismo origen, nunca embebible. El sitio público no lleva CSP: carga etiquetas de terceros
// configurables desde Integraciones y una CSP fija las rompería.
const CRM_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
function setSecurityHeaders(res, isCrm) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', isCrm ? 'DENY' : 'SAMEORIGIN');
  if (isCrm) res.setHeader('Content-Security-Policy', CRM_CSP);
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function corsPublic(res, methods) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function baseUrl(req) {
  if (process.env.APP_URL) return String(process.env.APP_URL).replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0] || (IS_PROD ? 'https' : 'http');
  const host = (req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  return `${proto}://${host}`;
}
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || '0.0.0.0';
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); } }
  });
  return out;
}
// Lee el body JSON con tope de tamaño (1 MB por defecto; 5 MB en la captura de leads con fotos).
function readBody(req, maxBytes = 1e6) {
  // Vercel (y otros frameworks) pre-parsean el body → úsalo si ya viene resuelto
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return Promise.resolve(req.body ? JSON.parse(req.body) : {}); } catch (e) { return Promise.resolve({}); } }
    if (typeof req.body === 'object') return Promise.resolve(req.body);
  }
  return new Promise((resolve) => {
    const chunks = []; let size = 0; let done = false; let timer = null;
    const parse = () => { const b = Buffer.concat(chunks).toString('utf8'); try { return b ? JSON.parse(b) : {}; } catch (e) { return {}; } };
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    // Salvaguarda por inactividad: si el stream ya fue consumido y no re-emite, no cuelgues
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => finish(parse()), 8000); };
    req.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(); return finish({ __too_large: true }); } chunks.push(c); arm(); });
    req.on('end', () => finish(parse()));
    req.on('error', () => finish({}));
    arm();
  });
}
const COOKIE = 'wy_sid';
const sidCookie = (sid, days = 7) => `${COOKIE}=${sid}; HttpOnly; ${IS_PROD ? 'Secure; ' : ''}Path=/; Max-Age=${days * 86400}; SameSite=Lax`;
const clearCookie = () => `${COOKIE}=; HttpOnly; ${IS_PROD ? 'Secure; ' : ''}Path=/; Max-Age=0; SameSite=Lax`;

// Rate limit fijo por ventana, respaldado en BD (funciona entre invocaciones serverless)
async function rateOk(bucket, max, windowSec) {
  const now = Date.now();
  const row = await db.get('SELECT count, window_start FROM rate_hits WHERE bucket=?', [bucket]);
  if (!row) { await db.run('INSERT INTO rate_hits (bucket,count,window_start) VALUES (?,1,?)', [bucket, String(now)]); return true; }
  if (now - Number(row.window_start) > windowSec * 1000) {
    await db.run('UPDATE rate_hits SET count=1, window_start=? WHERE bucket=?', [String(now), bucket]);
    return true;
  }
  if (Number(row.count) < max) { await db.run('UPDATE rate_hits SET count=count+1 WHERE bucket=?', [bucket]); return true; }
  return false;
}

async function currentUser(req) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  const s = await db.get('SELECT * FROM sessions WHERE id = ?', [sid]);
  if (!s || s.expires_at < nowISO()) return null;
  const u = await db.get('SELECT id,name,email,role,active,lang FROM users WHERE id = ?', [s.user_id]);
  return u && u.active ? { ...u, impersonator_id: s.impersonator_id || null } : null;
}
// Idioma de la PERSONA que usa el panel: en «Entrar como» es el del administrador que entró (no el del usuario suplantado),
// así cambiar de idioma mientras ayuda a alguien no le cambia el idioma (ni el de sus correos) a esa persona.
const langOwnerId = (user) => (user.impersonator_id ? Number(user.impersonator_id) : user.id);
async function humanLang(user) {
  if (!user.impersonator_id) return userLang(user);
  const adm = await db.get('SELECT lang FROM users WHERE id=?', [user.impersonator_id]);
  return userLang(adm || user);
}
async function sessionRow(req) {
  const sid = parseCookies(req)[COOKIE];
  if (!sid) return null;
  return (await db.get('SELECT * FROM sessions WHERE id = ?', [sid])) || null;
}
// Destinatarios con idioma: [{ email, lang }]
async function activeAdmins() {
  const rows = await db.all("SELECT email, lang FROM users WHERE role='admin' AND active=1");
  return rows.map((r) => ({ email: String(r.email || '').trim(), lang: userLang(r) })).filter((r) => EMAIL_RE.test(r.email));
}
// Admins activos + notify_emails (csv) sin duplicados. Un correo extra que sea de un usuario usa su idioma; si no, inglés.
async function notificationRecipients() {
  const seen = new Map();
  for (const a of await activeAdmins()) if (!seen.has(a.email.toLowerCase())) seen.set(a.email.toLowerCase(), a);
  try {
    const s = await getAllSettings();
    const extra = String(s.notify_emails || '').split(/[,;\s]+/).map((e) => e.trim()).filter((e) => EMAIL_RE.test(e));
    for (const e of extra) {
      const k = e.toLowerCase();
      if (seen.has(k)) continue;
      const u = await db.get('SELECT lang FROM users WHERE lower(email)=?', [k]);
      seen.set(k, { email: e, lang: (u && normLang(u.lang)) || 'en' });
    }
  } catch (e) { /* noop */ }
  return Array.from(seen.values());
}
// [{ email, lang }] → [[lang, [emails]]] en orden de aparición: un correo por idioma
function groupByLang(list) {
  const m = new Map();
  for (const r of list || []) { const l = normLang(r.lang) || 'en'; if (!m.has(l)) m.set(l, []); m.get(l).push(r.email); }
  return Array.from(m.entries());
}

// ---------------- Schema + seed + settings ----------------
let _initP = null;
export function ensureInit() { return _initP || (_initP = doInit()); }
async function doInit() {
  await db.ready();
  await ensureSchema();
  await seed();
  await backfillLangs();
  await ensureSettings();
  try { await db.run("DELETE FROM redirects WHERE from_path LIKE '/http%'"); } catch (e) { /* noop */ }
}
async function ensureSchema() {
  await db.execMany([
    `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL DEFAULT 'comercial', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, lang TEXT)`,
    `CREATE TABLE IF NOT EXISTS magic_tokens (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, impersonator_id INTEGER)`,
    `CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY,
      name TEXT, email TEXT, mobile TEXT,
      suburb TEXT, postcode TEXT, city TEXT,
      service TEXT,
      items TEXT,
      condition TEXT,
      days TEXT, time TEXT,
      addons TEXT,
      notes TEXT,
      source TEXT DEFAULT 'quote',
      status TEXT NOT NULL DEFAULT 'nuevo',
      loss_reason TEXT, owner_id INTEGER, attribution TEXT,
      quoted_at TEXT,
      spam INTEGER NOT NULL DEFAULT 0, spam_reason TEXT, recaptcha_score REAL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS lead_files (id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, name TEXT, mime TEXT, size INTEGER, data TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS lead_events (id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, type TEXT NOT NULL, from_status TEXT, to_status TEXT, loss_reason TEXT, note TEXT, user_id INTEGER, created_at TEXT NOT NULL, meta TEXT)`,
    `CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, user_id INTEGER, title TEXT NOT NULL, due_at TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, done_at TEXT, notified INTEGER NOT NULL DEFAULT 0, emailed INTEGER NOT NULL DEFAULT 0, email_id TEXT, created_by INTEGER, created_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(done, due_at)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS redirects (id INTEGER PRIMARY KEY, from_path TEXT NOT NULL UNIQUE, to_path TEXT NOT NULL, code INTEGER NOT NULL DEFAULT 301, active INTEGER NOT NULL DEFAULT 1, hits INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rate_hits (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_updated ON leads(updated_at)`,
    `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
    `CREATE INDEX IF NOT EXISTS idx_events_lead ON lead_events(lead_id)`,
    `CREATE INDEX IF NOT EXISTS idx_files_lead ON lead_files(lead_id)`,
  ]);
  // Migraciones idempotentes para BDs preexistentes (columnas ya incluidas arriba en BDs nuevas)
  for (const stmt of [
    'ALTER TABLE leads ADD COLUMN attribution TEXT',
    'ALTER TABLE leads ADD COLUMN quoted_at TEXT',
    'ALTER TABLE sessions ADD COLUMN impersonator_id INTEGER',
    'ALTER TABLE tasks ADD COLUMN notified INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN emailed INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN email_id TEXT',
    'ALTER TABLE tasks ADD COLUMN created_by INTEGER',
    // reCAPTCHA v3: leads retenidos como spam (se guardan para poder recuperar falsos positivos)
    'ALTER TABLE leads ADD COLUMN spam INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE leads ADD COLUMN spam_reason TEXT',
    'ALTER TABLE leads ADD COLUMN recaptcha_score REAL',
    // Idioma del panel y de los correos de cada usuario ('es' | 'en')
    'ALTER TABLE users ADD COLUMN lang TEXT',
    // Datos de las notas de sistema de la línea de tiempo (JSON) para pintarlas en el idioma de quien mira
    'ALTER TABLE lead_events ADD COLUMN meta TEXT',
  ]) {
    try { await db.run(stmt); } catch (e) { /* la columna ya existe */ }
  }
}
// Idempotente (cada arranque): usuarios sin idioma → 'es' el administrador principal (ADMIN_EMAIL), 'en' el resto.
async function backfillLangs() {
  const adminEmail = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim();
  await db.run('UPDATE users SET lang=? WHERE lang IS NULL AND lower(email)=lower(?)', ['es', adminEmail]);
  await db.run("UPDATE users SET lang='en' WHERE lang IS NULL");
}
async function seed() {
  const c = await db.get('SELECT COUNT(*) c FROM users');
  if (Number(c.c) > 0) return;
  const t = nowISO();
  const adminEmail = (process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const admin2 = (process.env.ADMIN_EMAIL_2 || 'Kenleong23@wyeleeassembly.com.au').trim().toLowerCase();
  await db.run('INSERT INTO users (name,email,role,active,created_at,lang) VALUES (?,?,?,1,?,?)', ['Administrador', adminEmail, 'admin', t, 'es']);
  if (admin2 && admin2 !== adminEmail) {
    await db.run('INSERT OR IGNORE INTO users (name,email,role,active,created_at,lang) VALUES (?,?,?,1,?,?)', ['Ken Leong', admin2, 'admin', t, 'en']);
  }
  console.log('· Seed: admins (' + adminEmail + (admin2 && admin2 !== adminEmail ? ', ' + admin2 : '') + '), 0 leads.');
}

const DEFAULT_SETTINGS = {
  tracking_enabled: '0',
  ga4_id: '', gtm_id: '', google_ads_id: '', google_ads_label: '',
  meta_pixel_id: '', tiktok_pixel_id: '', clarity_id: '', hotjar_id: '',
  custom_head: '', custom_body_start: '', custom_body_end: '',
  snippets: '[]',
  notify_emails: '',
  whatsapp_number: '61432470313',
  // clave de sitio (PÚBLICA, va en el HTML) de reCAPTCHA v3 — cuenta wyeleeassembly@gmail.com, proyecto «Wyelee website»,
  // dominios wyeleeassembly.com.au + wyelee.vercel.app. Se siembra solo si la BD no tiene ya el ajuste; se cambia en
  // Integraciones y RECAPTCHA_SITE_KEY (env) manda sobre ambas. El SECRETO va solo en Vercel (RECAPTCHA_SECRET).
  recaptcha_site_key: '6LdoN98tAAAAALjMBY8l1VoQ5sNCktizFsx-ZGi2',
  recaptcha_min_score: '0.5',      // umbral 0.1–0.9: por debajo, el lead queda retenido como spam
};
const ALLOWED_SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);
const SNIPPET_POSITIONS = ['head', 'body_start', 'body_end'];
async function ensureSettings() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await db.run('INSERT OR IGNORE INTO settings (key,value,updated_at) VALUES (?,?,?)', [k, v, nowISO()]);
  }
}
async function getAllSettings() {
  const o = { ...DEFAULT_SETTINGS };
  for (const r of await db.all('SELECT key,value FROM settings')) o[r.key] = r.value;
  return o;
}
function parseSnippets(raw) {
  let arr;
  try { arr = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw; } catch (e) { arr = []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const s of arr) {
    if (!s || typeof s !== 'object') continue;
    const code = String(s.code == null ? '' : s.code).slice(0, 20000);
    const name = cap(s.name, 80) || 'Fragmento';
    const position = SNIPPET_POSITIONS.includes(s.position) ? s.position : 'body_end';
    const enabled = (s.enabled === true || s.enabled === 1 || s.enabled === '1') ? 1 : 0;
    const id = String(s.id || '').replace(/[^\w-]/g, '').slice(0, 24) || shortId();
    out.push({ id, name, position, enabled, code });
    if (out.length >= 50) break;
  }
  return out;
}
function publicSiteConfig(s) {
  const enabled = s.tracking_enabled === '1';
  // El anti-spam no depende del interruptor de etiquetas: la clave de sitio se publica siempre
  const recaptcha_site_key = recaptchaSiteKey(s).key;
  if (!enabled) {
    return {
      enabled: false, ga4_id: '', gtm_id: '', google_ads_id: '', google_ads_label: '', meta_pixel_id: '', tiktok_pixel_id: '',
      clarity_id: '', hotjar_id: '', custom_head: '', custom_body_start: '', custom_body_end: '', snippets: [], recaptcha_site_key,
    };
  }
  return {
    enabled: true, recaptcha_site_key,
    ga4_id: s.ga4_id || '', gtm_id: s.gtm_id || '', google_ads_id: s.google_ads_id || '', google_ads_label: s.google_ads_label || '',
    meta_pixel_id: s.meta_pixel_id || '', tiktok_pixel_id: s.tiktok_pixel_id || '', clarity_id: s.clarity_id || '', hotjar_id: s.hotjar_id || '',
    custom_head: s.custom_head || '', custom_body_start: s.custom_body_start || '', custom_body_end: s.custom_body_end || '',
    snippets: parseSnippets(s.snippets).filter((x) => x.enabled).map(({ id, name, position, code }) => ({ id, name, position, code })),
  };
}

// ---------------- reCAPTCHA v3 (anti-spam de los formularios del sitio) ----------------
// Clave de sitio (pública): env RECAPTCHA_SITE_KEY > ajuste del panel. Secreto: SOLO env RECAPTCHA_SECRET
// (nunca en BD, nunca devuelto por la API, nunca en logs). RECAPTCHA_VERIFY_URL existe solo para apuntar a un stub en pruebas.
const RECAPTCHA_VERIFY_DEFAULT = 'https://www.google.com/recaptcha/api/siteverify';
const RECAPTCHA_TIMEOUT_MS = 4000;
const RECAPTCHA_HOSTS = ['wyeleeassembly.com.au', 'www.wyeleeassembly.com.au', 'wyelee.vercel.app'];
const RECAPTCHA_SECRET_ERRORS = ['missing-input-secret', 'invalid-input-secret'];   // error de configuración nuestro, no del visitante
// Fail-open acotado: si Google no responde (o rechaza nuestro secreto), se aceptan como mucho 3 leads sin verificar por IP
// y 30 en total por hora; a partir de ahí quedan retenidos ('unverified limit'), recuperables desde Leads → Spam.
const RECAPTCHA_OPEN_PER_IP = 3, RECAPTCHA_OPEN_GLOBAL = 30;
const cleanSiteKey = (v) => String(v == null ? '' : v).trim().replace(/[^\w-]/g, '').slice(0, 100);
// trim: un salto de línea pegado en Vercel haría que Google rechazara el secreto en todos los envíos
const recaptchaSecret = () => String(process.env.RECAPTCHA_SECRET || '').trim();
// Una "clave de sitio" idéntica al secreto (pegado en el campo equivocado) nunca se publica ni se usa
function recaptchaSiteKey(s) {
  const secret = recaptchaSecret();
  const env = cleanSiteKey(process.env.RECAPTCHA_SITE_KEY);
  if (env && env !== secret) return { key: env, source: 'env' };
  const k = cleanSiteKey(s && s.recaptcha_site_key);
  return k && k !== secret ? { key: k, source: 'setting' } : { key: '', source: 'none' };
}
// Umbral 0.1–0.9 con un decimal (texto, como el resto de ajustes)
function clampMinScore(v) {
  const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
  if (!isFinite(n)) return '0.5';
  return (Math.round(Math.min(0.9, Math.max(0.1, n)) * 10) / 10).toFixed(1);
}
function recaptchaAllowedHosts() {
  const set = new Set(RECAPTCHA_HOSTS);
  try { if (process.env.APP_URL) set.add(new URL(process.env.APP_URL).hostname.toLowerCase()); } catch (e) { /* APP_URL mal formada: se ignora */ }
  return set;
}
// Veredicto del token: 'off' (sin secreto o sin clave de sitio: como antes), 'unverified' (Google no respondió → se acepta),
// 'spam' (retener: sin token, token inválido, acción/dominio que no cuadran o puntuación baja) u 'ok'. Nunca lanza.
async function verifyRecaptcha({ token: tok, action, ip, settings }) {
  const secret = recaptchaSecret();
  if (!secret) return { verdict: 'off', score: null };
  // Sin clave de sitio el navegador no puede generar tokens: exigirlos retendría TODOS los leads reales → en pausa
  if (!recaptchaSiteKey(settings).key) { console.warn('[recaptcha] RECAPTCHA_SECRET definido pero sin clave de sitio: verificación en pausa'); return { verdict: 'off', score: null }; }
  const minScore = Number(clampMinScore(settings && settings.recaptcha_min_score));
  const t = typeof tok === 'string' ? tok.trim() : '';
  if (!t) return { verdict: 'spam', reason: 'no token', score: null };
  if (t.length > 10000) return { verdict: 'spam', reason: 'invalid token', score: null };   // los tokens reales rondan 1–2 KB
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RECAPTCHA_TIMEOUT_MS);
  let data;
  try {
    const form = new URLSearchParams({ secret, response: t });
    if (ip && ip !== '0.0.0.0') form.set('remoteip', String(ip).slice(0, 64));
    const r = await fetch(process.env.RECAPTCHA_VERIFY_URL || RECAPTCHA_VERIFY_DEFAULT, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal: ctrl.signal,
    });
    if (!r.ok) { console.warn(`[recaptcha] siteverify HTTP ${r.status}: lead aceptado sin verificar`); return { verdict: 'unverified', score: null }; }
    data = await r.json();
  } catch (e) {
    console.warn(`[recaptcha] siteverify no disponible (${e && e.name === 'AbortError' ? 'timeout ' + RECAPTCHA_TIMEOUT_MS + ' ms' : 'red'}): lead aceptado sin verificar`);
    return { verdict: 'unverified', score: null };
  } finally { clearTimeout(timer); }
  if (!data || typeof data !== 'object') return { verdict: 'unverified', score: null };
  if (data.success !== true) {
    const codes = Array.isArray(data['error-codes']) ? data['error-codes'].map(String) : [];
    if (codes.some((c) => RECAPTCHA_SECRET_ERRORS.includes(c))) {
      console.error(`[recaptcha] Google rechaza RECAPTCHA_SECRET (${codes.join(',')}): revisa la variable en Vercel. Lead aceptado sin verificar.`);
      return { verdict: 'unverified', score: null };
    }
    return { verdict: 'spam', reason: 'invalid token', score: null };
  }
  const raw = typeof data.score === 'number' ? data.score : parseFloat(data.score);
  const score = isFinite(raw) ? Math.round(raw * 100) / 100 : null;
  const gotAction = data.action == null ? null : String(data.action).slice(0, 40);
  if (gotAction !== action) return { verdict: 'spam', reason: 'action mismatch', score, action: gotAction };
  const host = String(data.hostname || '').toLowerCase();
  if (!recaptchaAllowedHosts().has(host)) return { verdict: 'spam', reason: 'hostname mismatch', score, action: gotAction };
  if (score == null) return { verdict: 'spam', reason: 'no score', score, action: gotAction };
  if (score < minScore) return { verdict: 'spam', reason: `score ${score}`, score, action: gotAction };
  return { verdict: 'ok', score, action: gotAction };
}
// Cupo del fail-open (rate_hits): un bot no decide cuándo falla Google, pero si coincide con una caída (o con un secreto
// mal puesto, que deja TODO sin verificar) no puede colar más de RECAPTCHA_OPEN_PER_IP leads por hora y por IP.
async function capFailOpen(rc, ip) {
  if (rc.verdict !== 'unverified') return rc;
  if (await rateOk(`rc-open:${ip}`, RECAPTCHA_OPEN_PER_IP, 3600) && await rateOk('rc-open:*', RECAPTCHA_OPEN_GLOBAL, 3600)) return rc;
  console.warn(`[recaptcha] cupo de leads sin verificar agotado (${RECAPTCHA_OPEN_PER_IP}/h por IP, ${RECAPTCHA_OPEN_GLOBAL}/h en total): lead retenido`);
  return { verdict: 'spam', reason: 'unverified limit', score: null };
}
// Ajustes para el panel (admin): + campos de solo lectura del anti-spam. El secreto nunca sale de process.env.
function settingsOut(s) {
  const o = { ...s, snippets: JSON.stringify(parseSnippets(s.snippets)) };
  const rk = recaptchaSiteKey(s);
  const secret = recaptchaSecret();
  if (secret && cleanSiteKey(o.recaptcha_site_key) === secret) o.recaptcha_site_key = '';   // nunca devolver el secreto
  o.recaptcha_min_score = clampMinScore(s.recaptcha_min_score);
  o.recaptcha_secret_configured = !!secret;
  o.recaptcha_key_source = rk.source;              // 'env' | 'setting' | 'none'
  o.recaptcha_site_key_effective = rk.key;          // pública (es la misma que publica /api/public/site-config)
  return o;
}

// ---------------- Redirects ----------------
function normFrom(s) {
  s = String(s || '').trim();
  if (!s) return '';
  const u = s.match(/^https?:\/\/[^/]+(\/[^\s]*)?$/i);
  if (u) s = u[1] || '/';
  s = s.split('#')[0].split('?')[0];
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1) s = s.replace(/\/+$/, '') || '/';
  return s;
}
function normTo(s) {
  s = String(s || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (!s.startsWith('/')) s = '/' + s;
  return s;
}
async function findRedirect(pathname) {
  const key = pathname.length > 1 ? (pathname.replace(/\/+$/, '') || '/') : pathname;
  return (await db.get('SELECT id, to_path, code FROM redirects WHERE active=1 AND from_path=? LIMIT 1', [key])) || null;
}

// ---------------- Auth ----------------
async function requestMagicLink(email, base) {
  try { await db.run('DELETE FROM magic_tokens WHERE used=1 OR expires_at < ?', [nowISO()]); } catch (e) { /* noop */ }
  try { await db.run('DELETE FROM sessions WHERE expires_at < ?', [nowISO()]); } catch (e) { /* noop */ }
  try { await db.run('DELETE FROM rate_hits WHERE window_start < ?', [String(Date.now() - 864e5)]); } catch (e) { /* noop: cubos de rate-limit de hace más de un día */ }
  const u = await db.get('SELECT * FROM users WHERE lower(email)=lower(?) AND active=1', [email]);
  if (!u) return { ok: false };
  try { await db.run('UPDATE magic_tokens SET used=1 WHERE user_id=? AND used=0', [u.id]); } catch (e) { /* noop */ }
  const t = token(24);
  await db.run('INSERT INTO magic_tokens (token,user_id,expires_at,used,created_at) VALUES (?,?,?,0,?)', [t, u.id, addMinutes(15).toISOString(), nowISO()]);
  const link = `${base}/crm/auth/verify?token=${t}`;
  if (process.env.RESEND_API_KEY) await sendMagicLink({ to: u.email, name: u.name, link, lang: userLang(u) });   // idioma del destinatario
  if (!IS_PROD) console.log(`\n  ✉  Magic link para ${u.email} (${u.name}):\n     ${link}\n`);
  return { ok: true, link, name: u.name };
}
async function verifyToken(t) {
  if (!t || !/^[a-f0-9]{20,64}$/i.test(t)) return null;
  const row = await db.get('SELECT * FROM magic_tokens WHERE token=?', [t]);
  if (!row || row.used || row.expires_at < nowISO()) return null;
  await db.run('UPDATE magic_tokens SET used=1 WHERE token=?', [t]);
  const sid = token(24);
  await db.run('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)', [sid, row.user_id, addDays(new Date(), 7).toISOString(), nowISO()]);
  return sid;
}

// ---------------- Leads: normalización / validación ----------------
// Devuelve { ok:true, lead } o { ok:false, error } con error = clave de MSG (el llamador la traduce: inglés en el sitio)
function normalizeLead(b, source) {
  const out = {};
  const isContact = source === 'contact';
  out.name = cap(b.name, 120);
  let email = cap(b.email, 160);
  let mobile = normMobile(b.mobile);
  if (isContact) {
    const c = cap(b.contact, 160);
    if (c) { if (c.includes('@')) email = email || c; else mobile = mobile || normMobile(c); }
  }
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: 'invalid_email' };
  if (!email && !mobile) return { ok: false, error: 'contact_required' };
  out.email = email ? email.toLowerCase() : null;
  out.mobile = mobile;
  out.suburb = cap(b.suburb, 80);
  const pc = cap(b.postcode, 10);
  if (pc && !/^\d{4}$/.test(pc)) return { ok: false, error: 'postcode' };
  out.postcode = pc;
  out.city = cap(b.city, 80);
  out.service = isContact ? null : normKey(b.service, SERVICES);
  out.items = cap(b.items, 4000);
  out.condition = normKey(b.condition, CONDITIONS);
  out.days = normKey(b.days, DAYS);
  out.time = normKey(b.time, TIMES);
  out.addons = normAddons(b.addons);
  out.notes = cap(isContact ? (b.message != null ? b.message : b.notes) : (b.notes != null ? b.notes : b.message), 4000);
  return { ok: true, lead: out };
}
function normalizePhotos(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const type = String(p.type || p.mime || '').toLowerCase().trim();
    if (!PHOTO_TYPES.includes(type)) continue;
    let data = String(p.data || '');
    const m = data.match(/^data:[^;]+;base64,(.*)$/s);
    if (m) data = m[1];
    data = data.replace(/\s+/g, '');
    if (!data || data.length > MAX_PHOTO_B64 || !/^[A-Za-z0-9+/=]+$/.test(data)) continue;
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    const name = (cap(p.name, 120) || `photo-${out.length + 1}.${ext}`).replace(/[\\/:*?"<>|]+/g, '_');
    out.push({ name, mime: type, size: Math.floor(data.length * 3 / 4), data });
    if (out.length >= MAX_PHOTOS) break;
  }
  return out;
}
function channelOf(attr) {
  if (!attr || typeof attr !== 'object') return 'directo';
  const src = clean(attr.utm_source), med = clean(attr.utm_medium);
  if (src) return (src + (med ? '/' + med : '')).slice(0, 60);
  if (clean(attr.gclid)) return 'google/cpc';
  const ref = clean(attr.referrer);
  if (ref) { try { return new URL(ref).hostname.replace(/^www\./, '').slice(0, 60); } catch (e) { return String(ref).slice(0, 60); } }
  return 'directo';
}
// recaptcha = { verdict, score, action } → clave 'recaptcha' del JSON (en todos los leads del sitio).
// Tope ~2000 caracteres acortando los valores (antes se cortaba el JSON y quedaba inválido → la ficha no mostraba el origen).
function attributionJson(attr, recaptcha) {
  const src = attr && typeof attr === 'object' ? attr : {};
  const keys = ['page', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'channel', 'landing'];
  const build = (max) => {
    const keep = {};
    for (const k of keys) if (src[k] != null && String(src[k]).trim() !== '') keep[k] = String(src[k]).slice(0, max);
    if (recaptcha) keep.recaptcha = { verdict: recaptcha.verdict, score: recaptcha.score == null ? null : recaptcha.score, action: recaptcha.action || null };
    return keep;
  };
  let keep = build(300);
  if (!Object.keys(keep).length) return null;
  let j = JSON.stringify(keep);
  for (const max of [150, 80, 40]) { if (j.length <= 2000) break; keep = build(max); j = JSON.stringify(keep); }
  return j;
}
// Etiquetas para los correos. Servicio/condición/días/franja/extras ya son inglés (los del sitio); el estado va en `lang`.
function leadLabels(l, lang = 'es') {
  const st = STATUS_LABELS_I18N[normLang(lang) || 'es'];
  return {
    ...l,
    service_label: l.service ? (SERVICES[l.service] || l.service) : null,
    condition_label: l.condition ? (CONDITIONS[l.condition] || l.condition) : null,
    days_label: l.days ? (DAYS[l.days] || l.days) : null,
    time_label: l.time ? (TIMES[l.time] || l.time) : null,
    addons_label: l.addons ? labelsOf(l.addons, ADDONS) : null,
    status_label: l.status ? (st[l.status] || l.status) : null,
  };
}

// ---------------- Línea de tiempo: notas de sistema en el idioma de quien mira ----------------
// Las notas que escribe el servidor (lead recibido, creado a mano, tarea, tarea hecha/reabierta, spam) se guardan en español
// como siempre y, además, con `meta` (JSON). En inglés se pintan desde `meta`; las antiguas (sin meta) se traducen por patrón.
// Las notas que escriben las personas (type 'note' y las de los cambios de estado) nunca se traducen.
const SYS_EVENT_TYPES = new Set(['created', 'task', 'task_done', 'spam']);
// Canal: 'directo' lo pone channelOf(); 'Directo'/'Orgánico' vienen de los datos de demostración (_seed_demo.mjs)
const CHAN_EN = { directo: 'direct', 'orgánico': 'organic' };
const chanLabel = (c, lang) => {
  const en = lang === 'en' ? CHAN_EN[String(c || '').toLowerCase()] : null;
  return en ? (/^[A-ZÁÉÍÓÚ]/.test(String(c)) ? en[0].toUpperCase() + en.slice(1) : en) : c;
};
// '30/09/2026, 11:00 p. m. (Adelaide)' (es-CO, ya en hora de Adelaide) → '30 Sept 2026, 11:00 pm (Adelaide)'
function legacyAdelaideEn(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?\s*\(Adelaide\)$/i);
  if (!m) return s;
  const h = (Number(m[4]) % 12) + (m[6].toLowerCase() === 'p' ? 12 : 0);
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1]), h, Number(m[5])));
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-AU', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' (Adelaide)';
}
const srcEn = (s) => ({ quote: 'quote form', contact: 'contact form' }[s] || s);
function unspamOriginEn(reason, score) {
  if (reason === 'manual') return 'it had been marked as spam manually';
  const why = !reason || reason === 'sin motivo' ? 'no reason' : reason;
  return `reCAPTCHA had held it: ${why}${score != null && score !== '' ? ` · score ${score}` : ''}`;
}
function eventNoteEn(ev) {
  let m = null;
  try { m = ev.meta ? JSON.parse(ev.meta) : null; } catch (e) { m = null; }
  if (m && typeof m === 'object' && m.k) {
    if (m.k === 'site') return `Received from the website (${srcEn(m.source)}) · ${chanLabel(m.channel, 'en')}${m.held ? ` · held as spam by reCAPTCHA (${m.held})` : ''}`;
    if (m.k === 'manual') return 'Created manually in the panel';
    if (m.k === 'task') return `Task: ${m.title} · due ${adelaide(m.due, 'en')}`;
    if (m.k === 'task_done') return `Task done: ${m.title}`;
    if (m.k === 'task_reopen') return `Task reopened: ${m.title}`;
    if (m.k === 'unspam') return `Marked as NOT spam: back in the pipeline (${unspamOriginEn(m.reason, /^score /.test(String(m.reason || '')) ? null : m.score)})`;
    if (m.k === 'spam') return 'Marked as spam: removed from the pipeline and the stats';
  }
  const s = String(ev.note == null ? '' : ev.note);
  let x;
  if ((x = s.match(/^Recibido desde el sitio web \(([^)]*)\) · (.*?)(?: · retenido como spam por reCAPTCHA \((.*)\))?$/s))) {
    return `Received from the website (${srcEn(x[1])}) · ${chanLabel(x[2], 'en')}${x[3] ? ` · held as spam by reCAPTCHA (${x[3]})` : ''}`;
  }
  if (s === 'Creado manualmente en el panel') return 'Created manually in the panel';
  if ((x = s.match(/^Tarea: (.*) · vence (.*)$/s))) return `Task: ${x[1]} · due ${legacyAdelaideEn(x[2])}`;
  if ((x = s.match(/^Tarea hecha: (.*)$/s))) return `Task done: ${x[1]}`;
  if ((x = s.match(/^Tarea reabierta: (.*)$/s))) return `Task reopened: ${x[1]}`;
  if ((x = s.match(/^Marcado como NO spam: vuelve al pipeline \((.*)\)$/s))) {
    const o = x[1];
    if (o === 'lo habían marcado como spam a mano') return `Marked as NOT spam: back in the pipeline (${unspamOriginEn('manual')})`;
    const r = o.match(/^reCAPTCHA lo había retenido: (.*?)(?: · puntuación (.*))?$/s);
    return r ? `Marked as NOT spam: back in the pipeline (${unspamOriginEn(r[1], r[2])})` : s;
  }
  if (s === 'Marcado como spam: retirado del pipeline y de las estadísticas') return 'Marked as spam: removed from the pipeline and the stats';
  return ev.note;
}
// En 'es' la nota guardada ya es la de siempre; en 'en' se traduce. `meta` no sale en la respuesta.
function localizeEvents(events, lang) {
  return (events || []).map((ev) => {
    const { meta, ...rest } = ev;
    if (lang !== 'en' || !SYS_EVENT_TYPES.has(ev.type) || ev.note == null) return rest;
    return { ...rest, note: eventNoteEn(ev) };
  });
}
const metaJson = (o) => JSON.stringify(o);
async function leadRow(r) {
  if (!r) return r;
  const owner = r.owner_id ? await db.get('SELECT name FROM users WHERE id=?', [r.owner_id]) : null;
  return { ...r, owner_name: owner ? owner.name : null, hours_open: hoursBetween(r.created_at, nowISO()) };
}
const LEAD_COLS = 'name,email,mobile,suburb,postcode,city,service,items,condition,days,time,addons,notes';
async function insertLead(lead, { source, status = 'nuevo', ownerId = null, attribution = null, t = nowISO(), spam = 0, spamReason = null, recaptchaScore = null }) {
  const r = await db.run(`INSERT INTO leads (${LEAD_COLS},source,status,owner_id,attribution,spam,spam_reason,recaptcha_score,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [lead.name, lead.email, lead.mobile, lead.suburb, lead.postcode, lead.city, lead.service, lead.items, lead.condition, lead.days, lead.time, lead.addons, lead.notes,
      source, status, ownerId, attribution, spam ? 1 : 0, spamReason, recaptchaScore, t, t]);
  return r.lastInsertRowid;
}
const parseAttr = (raw) => { try { const a = typeof raw === 'string' ? JSON.parse(raw || 'null') : raw; return a && typeof a === 'object' ? a : null; } catch (e) { return null; } };
// Aviso de nuevo lead por correo a admins + notify_emails (al llegar desde el sitio, o al recuperarlo de Spam).
// Un correo por idioma: cada destinatario lo recibe en el suyo (correos extra que no son usuarios → inglés).
// Best-effort: nunca lanza. Devuelve 'sent' | 'skipped' (sin RESEND_API_KEY) | 'failed' (algún envío falló) | 'none' (sin destinatarios).
async function notifyNewLead({ base, id, lead, source, attribution, files, createdAt, why }) {
  let status = 'none';
  try {
    const to = await notificationRecipients();
    const groups = groupByLang(to);
    if (groups.length) {
      const attr = attribution && typeof attribution === 'object' ? attribution : null;
      const page = attr && attr.page ? String(attr.page).slice(0, 200) : null;
      const results = [];
      for (const [lang, emails] of groups) {
        const r = await sendLeadNotification({
          to: emails,
          lang,
          crmLink: `${base}/crm#lead-${id}`,
          lead: { ...leadLabels({ ...lead, source, status: lead.status || 'nuevo' }, lang), channel: channelOf(attr), page, created_at: createdAt },
          files: (files || []).map((ph) => ({ name: ph.name, mime: ph.mime, data: ph.data })),
        });
        results.push(r || {});
      }
      status = results.every((r) => r.ok) ? 'sent' : (results.every((r) => r.skipped) ? 'skipped' : 'failed');
    }
    console.log(`[lead] aviso de lead #${id} (${why}) → ${to.length} destinatario(s), ${groups.map(([l, e]) => `${l}:${e.length}`).join(' ') || '—'}: ${status}`);
  } catch (e) { status = 'failed'; console.error('[lead] notify', e?.message || e); }
  return status;
}

// ---------------- Tareas: programación de recordatorios ----------------
// Responsable de la tarea con su idioma; sin responsable (o inactivo) → todos los admins activos, cada uno en el suyo.
async function taskRecipients(task) {
  if (task.user_id) {
    const u = await db.get('SELECT email, lang FROM users WHERE id=? AND active=1', [task.user_id]);
    if (u && EMAIL_RE.test(String(u.email || ''))) return [{ email: u.email, lang: userLang(u) }];
  }
  return activeAdmins();
}
// tasks.email_id guarda los ids de Resend separados por coma (uno por idioma cuando la tarea es de «cualquiera»).
const emailIds = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
// Programa el recordatorio en Resend (scheduled_at = due_at), un correo por idioma. Guarda email_id/emailed. Nunca lanza.
// Si algún idioma falla se cancelan los ya programados y queda emailed=0: el respaldo lo envía a todos al vencer (sin duplicados).
async function scheduleTaskEmail(task, base) {
  try {
    if (!process.env.RESEND_API_KEY || !task || task.done) return;
    if (new Date(task.due_at).getTime() <= Date.now()) { await db.run('UPDATE tasks SET emailed=0, email_id=NULL WHERE id=?', [task.id]); return; } // vencida: la manda el respaldo
    const lead = await db.get('SELECT * FROM leads WHERE id=?', [task.lead_id]);
    if (lead && Number(lead.spam)) { await db.run('UPDATE tasks SET emailed=0, email_id=NULL WHERE id=?', [task.id]); return; } // retenido: se programa al recuperarlo
    const groups = groupByLang(await taskRecipients(task));
    if (!groups.length) return;
    const ids = []; let failed = false;
    for (const [lang, emails] of groups) {
      const r = await sendTaskReminder({ to: emails, lang, task, lead: leadLabels(lead || {}, lang), crmLink: `${base}/crm#lead-${task.lead_id}`, scheduledAt: task.due_at });
      if (r && r.ok && r.id) ids.push(r.id); else failed = true;
    }
    if (ids.length && !failed) await db.run('UPDATE tasks SET emailed=1, email_id=? WHERE id=?', [ids.join(','), task.id]);
    else {
      for (const eid of ids) await cancelScheduledEmail(eid);
      await db.run('UPDATE tasks SET emailed=0, email_id=NULL WHERE id=?', [task.id]);
    }
  } catch (e) { console.error('[tasks] schedule', e?.message || e); }
}
async function cancelTaskEmail(task) {
  try {
    if (!task || !task.email_id) return;
    if (new Date(task.due_at).getTime() > Date.now()) for (const eid of emailIds(task.email_id)) await cancelScheduledEmail(eid);
    await db.run('UPDATE tasks SET email_id=NULL WHERE id=?', [task.id]);
  } catch (e) { console.error('[tasks] cancel', e?.message || e); }
}
// Respaldo: envía por correo toda tarea abierta vencida con emailed=0 y la marca emailed=1.
async function processDueReminders(base) {
  let sent = 0, checked = 0;
  try {
    // Tareas de leads retenidos como spam: no avisan (vuelven a contar si el lead se recupera)
    const rows = await db.all('SELECT t.* FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id WHERE t.done=0 AND t.emailed=0 AND t.due_at <= ? AND coalesce(l.spam,0)=0 ORDER BY t.due_at ASC LIMIT 50', [nowISO()]);
    checked = rows.length;
    for (const task of rows) {
      const lead = await db.get('SELECT * FROM leads WHERE id=?', [task.lead_id]);
      const groups = groupByLang(await taskRecipients(task));
      let ok = false;
      if (groups.length && process.env.RESEND_API_KEY) {
        // Un correo por idioma. Basta con que salga uno para marcarla: reintentar todos repetiría el aviso (cada 60 s)
        // a quienes ya lo recibieron si otro idioma fallara de forma persistente.
        for (const [lang, emails] of groups) {
          const r = await sendTaskReminder({ to: emails, lang, task, lead: leadLabels(lead || {}, lang), crmLink: `${base}/crm#lead-${task.lead_id}` });
          if (r && r.ok) ok = true; else console.error(`[tasks] recordatorio de la tarea #${task.id} (${lang}) no salió`);
        }
      }
      // Sin RESEND_API_KEY (local) también se marca: no hay nada que reintentar y evita crecer la cola
      if (ok || !process.env.RESEND_API_KEY) { await db.run('UPDATE tasks SET emailed=1 WHERE id=?', [task.id]); if (ok) sent++; }
    }
  } catch (e) { console.error('[tasks] due-reminders', e?.message || e); }
  return { checked, sent };
}
const TASK_SELECT = `SELECT t.id, t.lead_id, l.name lead_name, l.mobile lead_mobile, l.status lead_status, t.user_id, u.name user_name, t.title, t.due_at, t.done, t.done_at, t.notified, t.emailed, t.created_by, t.created_at
  FROM tasks t LEFT JOIN leads l ON l.id=t.lead_id LEFT JOIN users u ON u.id=t.user_id`;
const taskOut = (r, now) => ({ ...r, done: Number(r.done) ? 1 : 0, overdue: !Number(r.done) && r.due_at < now });
const dayKey = (iso) => { try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); } catch (e) { return ''; } };

// ---------------- Stats ----------------
// Todas las métricas excluyen los leads retenidos como spam (reCAPTCHA): spam=0 en leads y en sus eventos.
const LIVE = 'spam=0';
const LIVE_EV = 'lead_id NOT IN (SELECT id FROM leads WHERE spam=1)';
async function buildStats(monthArg, lang = 'es') {
  const lossL = LOSS_REASONS_I18N[normLang(lang) || 'es'];
  const distinct = (await db.all(`SELECT DISTINCT substr(created_at,1,7) m FROM leads WHERE created_at IS NOT NULL AND ${LIVE}`)).map((r) => r.m);
  const curMonth = new Date().toISOString().slice(0, 7);
  const availableMonths = Array.from(new Set([...distinct, curMonth])).sort();
  const month = monthArg && /^\d{4}-\d{2}$/.test(monthArg) && availableMonths.includes(monthArg) ? monthArg : null;
  const inMonth = month ? ` AND substr(created_at,1,7)='${month}'` : '';

  const funnel = {};
  for (const s of STATUSES) funnel[s] = Number((await db.get(`SELECT COUNT(*) c FROM leads WHERE status=? AND ${LIVE}${inMonth}`, [s])).c);
  const total = Number((await db.get(`SELECT COUNT(*) c FROM leads WHERE ${LIVE}${inMonth}`)).c);

  const months = [];
  const d0 = new Date();
  for (let i = 5; i >= 0; i--) months.push(new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const map = (rows) => Object.fromEntries(rows.map((r) => [r.m, Number(r.c)]));
  const cM = map(await db.all(`SELECT substr(created_at,1,7) m, COUNT(*) c FROM leads WHERE ${LIVE} GROUP BY m`));
  const wM = map(await db.all(`SELECT substr(created_at,1,7) m, COUNT(*) c FROM lead_events WHERE type='status' AND to_status='ganado' AND ${LIVE_EV} GROUP BY m`));
  const lM = map(await db.all(`SELECT substr(created_at,1,7) m, COUNT(*) c FROM lead_events WHERE type='status' AND to_status='perdido' AND ${LIVE_EV} GROUP BY m`));
  const monthly = months.map((m) => {
    const created = cM[m] || 0, won = wM[m] || 0, lost = lM[m] || 0;
    const resolved = won + lost;
    return { month: m, created, won, lost, conversion: resolved ? Math.round((won / resolved) * 100) : 0 };
  });

  const lossRows = await db.all(`SELECT loss_reason r, COUNT(*) c FROM leads WHERE status='perdido' AND loss_reason IS NOT NULL AND ${LIVE}${inMonth} GROUP BY r ORDER BY c DESC`);
  const lossBreakdown = lossRows.map((r) => ({ key: r.r, label: lossL[r.r] || r.r, count: Number(r.c) }));

  const svcRows = await db.all(`SELECT service s, COUNT(*) c FROM leads WHERE ${LIVE}${inMonth} GROUP BY s ORDER BY c DESC`);
  const byService = svcRows.map((r) => ({ key: r.s || 'contact', label: r.s ? (SERVICES[r.s] || r.s) : tr(lang, 'no_service'), count: Number(r.c) }));
  const cityRows = await db.all(`SELECT coalesce(nullif(trim(city),''),'—') city, COUNT(*) c FROM leads WHERE ${LIVE}${inMonth} GROUP BY 1 ORDER BY c DESC LIMIT 20`);
  const byCity = cityRows.map((r) => ({ city: r.city, count: Number(r.c) }));

  let won, lost;
  if (month) {
    won = Number((await db.get(`SELECT COUNT(*) c FROM lead_events WHERE type='status' AND to_status='ganado' AND ${LIVE_EV} AND substr(created_at,1,7)='${month}'`)).c);
    lost = Number((await db.get(`SELECT COUNT(*) c FROM lead_events WHERE type='status' AND to_status='perdido' AND ${LIVE_EV} AND substr(created_at,1,7)='${month}'`)).c);
  } else { won = funnel.ganado; lost = funnel.perdido; }
  const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : 0;
  const newThisMonth = month ? total : (cM[months[months.length - 1]] || 0);
  const active = funnel.nuevo + funnel.contactado + funnel.cotizado + funnel.agendado;

  // SLA: tiempo medio hasta cotizar y % dentro de 24 h (sobre leads con quoted_at)
  const qRows = await db.all(`SELECT created_at, quoted_at FROM leads WHERE quoted_at IS NOT NULL AND ${LIVE}${inMonth}`);
  let sumH = 0, within = 0;
  for (const r of qRows) { const h = (new Date(r.quoted_at).getTime() - new Date(r.created_at).getTime()) / 36e5; sumH += h; if (h <= SLA_HOURS) within++; }
  const avgHoursToQuote = qRows.length ? Math.round((sumH / qRows.length) * 10) / 10 : null;
  const slaRate = qRows.length ? Math.round((within / qRows.length) * 100) : null;
  const cutoff = new Date(Date.now() - SLA_HOURS * 36e5).toISOString();
  const overdue = Number((await db.get(`SELECT COUNT(*) c FROM leads WHERE status='nuevo' AND ${LIVE} AND created_at < ?${inMonth}`, [cutoff])).c);
  const spamCount = Number((await db.get(`SELECT COUNT(*) c FROM leads WHERE spam=1${inMonth}`)).c);   // informativo: retenidos por reCAPTCHA

  return {
    funnel, total, monthly, lossBreakdown, byService, byCity, availableMonths, month, spamCount,
    kpi: { total, newThisMonth, won, lost, winRate, active, avgHoursToQuote, slaRate, overdue, quoted: qRows.length },
  };
}

// ---------------- Router ----------------
export async function handle(req, res) {
  await ensureInit();
  const url = new URL(req.url, baseUrl(req));
  let p = url.pathname;
  const method = req.method;

  const isCrm = p === '/crm' || p.startsWith('/crm/');
  if (isCrm) p = p.slice(4) || '/';
  setSecurityHeaders(res, isCrm);
  const isApi = p.startsWith('/api/');
  const hdrLang = normLang(req.headers['x-wy-lang']);   // el panel la manda en cada llamada (es | en)

  // Redirecciones administrables (panel → Redirecciones): páginas del sitio público, GET/HEAD, no assets
  if (!isCrm && !isApi && (method === 'GET' || method === 'HEAD')) {
    const ext = path.extname(p);
    if (!ext || ext === '.html') {
      const rd = await findRedirect(p);
      if (rd) {
        try { await db.run('UPDATE redirects SET hits = hits + 1 WHERE id=?', [rd.id]); } catch (e) { /* noop */ }
        const loc = /^https?:\/\//i.test(rd.to_path) ? rd.to_path : rd.to_path + (rd.to_path.indexOf('?') === -1 ? url.search : '');
        res.writeHead(rd.code || 301, { Location: loc, 'Cache-Control': 'no-cache' });
        return res.end();
      }
    }
  }

  // ---- Público: configuración de etiquetas/código de terceros que lee el sitio ----
  if (p === '/api/public/site-config') {
    corsPublic(res, 'GET, OPTIONS');
    if (method === 'OPTIONS') return send(res, 204, '');
    if (method !== 'GET') return json(res, 405, { error: 'method' });
    return json(res, 200, publicSiteConfig(await getAllSettings()), { 'Cache-Control': 'public, max-age=60, s-maxage=300' });
  }

  // ---- Público: captura de leads (rate-limit + honeypot + validación + fotos) ----
  if (p === '/api/public/lead') {
    corsPublic(res, 'POST, OPTIONS');
    if (method === 'OPTIONS') return send(res, 204, '');
    if (method !== 'POST') return json(res, 405, { error: 'method' });
    // El sitio es inglés: los mensajes de esta ruta pública van siempre en inglés (mismos textos que antes)
    if (!(await rateOk(`lead:${clientIp(req)}`, 20, 3600))) return json(res, 429, { error: tr('en', 'too_many_requests') });
    const b = await readBody(req, 5e6);
    if (b && b.__too_large) return json(res, 413, { error: tr('en', 'too_large') });
    if (clean(b.website)) return json(res, 201, { ok: true });                 // honeypot: no se guarda
    const source = b.source === 'contact' ? 'contact' : 'quote';
    const n = normalizeLead(b, source);
    if (!n.ok) return json(res, 400, { error: tr('en', n.error) });
    // reCAPTCHA v3 (acción = tipo de formulario). 'spam' → se guarda retenido, sin aviso; misma respuesta que un lead real.
    const ip = clientIp(req);
    const rc = await capFailOpen(await verifyRecaptcha({ token: b.recaptcha, action: source, ip, settings: await getAllSettings() }), ip);
    const isSpam = rc.verdict === 'spam';
    const t = nowISO();
    const attribution = attributionJson(b.attribution, rc);
    const channel = channelOf(b.attribution);
    const id = await insertLead(n.lead, { source, attribution, t, spam: isSpam ? 1 : 0, spamReason: isSpam ? rc.reason : null, recaptchaScore: rc.score });
    const held = isSpam ? ` · retenido como spam por reCAPTCHA (${rc.reason})` : '';
    await db.run(`INSERT INTO lead_events (lead_id,type,to_status,note,created_at,meta) VALUES (?, 'created','nuevo',?,?,?)`,
      [id, `Recibido desde el sitio web (${source}) · ${channel}${held}`, t, metaJson({ k: 'site', source, channel, held: isSpam ? rc.reason : null })]);
    const photos = source === 'quote' || Array.isArray(b.photos) ? normalizePhotos(b.photos) : [];
    for (const ph of photos) {
      await db.run('INSERT INTO lead_files (lead_id,name,mime,size,data,created_at) VALUES (?,?,?,?,?,?)', [id, ph.name, ph.mime, ph.size, ph.data, t]);
    }
    if (isSpam) {
      console.log(`[recaptcha] lead #${id} (${source}) retenido como spam: ${rc.reason}`);
    } else {
      // Notifica por correo a los administradores (+ notify_emails). Best-effort: nunca rompe la captura.
      await notifyNewLead({ base: baseUrl(req), id, lead: n.lead, source, attribution: b.attribution, files: photos, createdAt: t, why: `sitio web · reCAPTCHA ${rc.verdict}` });
    }
    return json(res, 201, { ok: true, id });
  }

  // ---- Auth (público) — rate-limited, respuesta neutra (sin enumeración, sin token en prod) ----
  if (p === '/api/auth/request' && method === 'POST') {
    // Pantalla de login (sin sesión): idioma de la cabecera X-Wy-Lang; si no viene, español como siempre
    if (!(await rateOk(`auth:${clientIp(req)}`, 6, 900))) return fail(res, 429, hdrLang || 'es', 'too_many_auth');
    const b = await readBody(req);
    const r = await requestMagicLink(String(b.email || '').trim().slice(0, 160), baseUrl(req));
    return json(res, 200, { ok: true, ...(!IS_PROD && r.ok ? { devLink: r.link } : {}) });
  }
  if (p === '/auth/verify' && method === 'GET') {
    const sid = await verifyToken(url.searchParams.get('token') || '');
    if (sid) { res.setHeader('Set-Cookie', sidCookie(sid, 7)); res.writeHead(302, { Location: '/crm', 'Cache-Control': 'no-store' }); return res.end(); }
    res.writeHead(302, { Location: '/crm#expired', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (p === '/api/auth/logout' && method === 'POST') {
    const sid = parseCookies(req)[COOKIE];
    if (sid) await db.run('DELETE FROM sessions WHERE id=?', [sid]);
    res.setHeader('Set-Cookie', clearCookie());
    return json(res, 200, { ok: true });
  }

  // ---- Cron (Vercel): respaldo de recordatorios por correo. Sin sesión; protegido por CRON_SECRET ----
  if (p === '/api/cron/tasks' && (method === 'GET' || method === 'POST')) {
    const secret = process.env.CRON_SECRET;
    // En producción el cron exige CRON_SECRET; sin él, se rechaza (en local queda abierto para pruebas)
    if (!secret && IS_PROD) return json(res, 401, { error: 'CRON_SECRET not configured' });
    if (secret) {
      const auth = String(req.headers.authorization || '');
      const given = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      const a = Buffer.from(given), s = Buffer.from(secret);
      if (a.length !== s.length || !crypto.timingSafeEqual(a, s)) return json(res, 401, { error: 'unauthorized' });
    }
    const r = await processDueReminders(baseUrl(req));
    return json(res, 200, { ok: true, ...r, at: nowISO() }, { 'Cache-Control': 'no-store' });
  }

  // ---- API protegida ----
  if (isApi) {
    res.setHeader('Cache-Control', 'no-store');
    const user = await currentUser(req);
    if (!user) return fail(res, 401, hdrLang || 'es', 'unauthorized');
    const isAdmin = user.role === 'admin';
    const now = nowISO();
    // Idioma de esta petición: cabecera X-Wy-Lang → idioma guardado de la persona → 'es'
    const lang = hdrLang || (await humanLang(user)) || 'es';
    const E = (code, key, vars) => fail(res, code, lang, key, vars);

    // `lang` = idioma de la persona que usa el panel (en «Entrar como», el del administrador; ver humanLang)
    const meOut = async () => {
      let impersonating = null;
      if (user.impersonator_id) {
        const adm = await db.get('SELECT id,name FROM users WHERE id=?', [user.impersonator_id]);
        if (adm) impersonating = { id: adm.id, name: adm.name };
      }
      return { id: user.id, name: user.name, email: user.email, role: user.role, lang: await humanLang(user), impersonating };
    };
    if (p === '/api/me' && method === 'GET') return json(res, 200, await meOut());
    // Cualquier usuario con sesión: { lang: 'es'|'en' } guarda su idioma (panel + correos que recibe)
    if (p === '/api/me' && method === 'PATCH') {
      const b = await readBody(req);
      const l = normLang(b && b.lang);
      if (!l) return E(400, 'invalid_lang');
      await db.run('UPDATE users SET lang=? WHERE id=?', [l, langOwnerId(user)]);
      if (!user.impersonator_id) user.lang = l;   // meOut lee el idioma de `user` (el del admin suplantando se relee de la BD)
      return json(res, 200, await meOut());
    }
    if (p === '/api/auth/stop-impersonate' && method === 'POST') {
      const sess = await sessionRow(req);
      if (!sess || !sess.impersonator_id) return E(400, 'not_impersonating');
      const admin = await db.get('SELECT * FROM users WHERE id=? AND active=1', [sess.impersonator_id]);
      if (!admin) return E(401, 'unauthorized');
      const sid = token(24);
      await db.run('INSERT INTO sessions (id,user_id,expires_at,created_at) VALUES (?,?,?,?)', [sid, admin.id, addDays(new Date(), 7).toISOString(), now]);
      await db.run('DELETE FROM sessions WHERE id=?', [sess.id]);
      res.setHeader('Set-Cookie', sidCookie(sid, 7));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/meta' && method === 'GET') {
      // statusLabels / lossReasons / roleLabels siguen en español (compatibilidad); las variantes *I18n traen { es, en }
      return json(res, 200, {
        statuses: STATUSES, statusLabels: STATUS_LABELS, lossReasons: LOSS_REASONS, services: SERVICES, conditions: CONDITIONS,
        addons: ADDONS, days: DAYS, times: TIMES, roles: ROLES, roleLabels: ROLE_LABELS, slaHours: SLA_HOURS, sources: SOURCES,
        langs: LANGS, statusLabelsI18n: STATUS_LABELS_I18N, lossReasonsI18n: LOSS_REASONS_I18N, roleLabelsI18n: ROLE_LABELS_I18N,
        sourceLabelsI18n: SOURCE_LABELS_I18N,
      });
    }

    // Leads (lista): filtrado en SQL, owner por JOIN, contadores por subconsulta, tope 1000
    if (p === '/api/leads' && method === 'GET') {
      const status = url.searchParams.get('status');
      const service = url.searchParams.get('service');
      const city = (url.searchParams.get('city') || '').trim().slice(0, 80);
      const qraw = (url.searchParams.get('q') || '').toLowerCase().slice(0, 80);
      // ?spam=1 → solo los retenidos por reCAPTCHA; por defecto se excluyen (Kanban, tabla, badges)
      const onlySpam = ['1', 'true'].includes(String(url.searchParams.get('spam') || '').toLowerCase());
      const clauses = [onlySpam ? 'l.spam=1' : 'l.spam=0']; const args = [];
      if (status && STATUSES.includes(status)) { clauses.push('l.status=?'); args.push(status); }
      if (service) { if (SERVICES[service]) { clauses.push('l.service=?'); args.push(service); } else if (service === 'contact' || service === 'none') clauses.push('l.service IS NULL'); }
      if (city) { clauses.push('lower(coalesce(l.city,\'\'))=lower(?)'); args.push(city); }
      if (qraw) {
        const like = '%' + qraw.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
        clauses.push("(lower(coalesce(l.name,'')||' '||coalesce(l.email,'')||' '||coalesce(l.mobile,'')||' '||coalesce(l.suburb,'')||' '||coalesce(l.postcode,'')||' '||coalesce(l.items,'')) LIKE ? ESCAPE '\\')");
        args.push(like);
      }
      const where = 'WHERE ' + clauses.join(' AND ');
      const rows = await db.all(`SELECT l.*, u.name owner_name,
          (SELECT COUNT(*) FROM lead_files f WHERE f.lead_id=l.id) photos,
          (SELECT COUNT(*) FROM tasks t WHERE t.lead_id=l.id AND t.done=0) open_tasks,
          (SELECT t.id FROM tasks t WHERE t.lead_id=l.id AND t.done=0 ORDER BY t.due_at ASC LIMIT 1) nt_id,
          (SELECT t.title FROM tasks t WHERE t.lead_id=l.id AND t.done=0 ORDER BY t.due_at ASC LIMIT 1) nt_title,
          (SELECT t.due_at FROM tasks t WHERE t.lead_id=l.id AND t.done=0 ORDER BY t.due_at ASC LIMIT 1) nt_due
        FROM leads l LEFT JOIN users u ON u.id=l.owner_id ${where} ORDER BY datetime(l.updated_at) DESC LIMIT 1000`, args);
      const spamCount = Number((await db.get('SELECT COUNT(*) c FROM leads WHERE spam=1')).c);
      return json(res, 200, {
        spamCount,
        leads: rows.map((r) => {
          const { nt_id, nt_title, nt_due, ...rest } = r;
          return {
            ...rest, photos: Number(r.photos || 0), open_tasks: Number(r.open_tasks || 0), spam: Number(r.spam) ? 1 : 0,
            hours_open: hoursBetween(r.created_at, now),
            next_task: nt_id ? { id: nt_id, title: nt_title, due_at: nt_due } : null,
          };
        }),
      });
    }
    if (p === '/api/leads' && method === 'POST') {
      const b = await readBody(req);
      const n = normalizeLead(b, b.source === 'contact' ? 'contact' : 'quote');
      if (!n.ok) return E(400, n.error);
      const t = nowISO();
      let ownerId = user.id;
      if ('owner_id' in b) ownerId = b.owner_id ? Number(b.owner_id) || null : null;
      const id = await insertLead(n.lead, { source: 'manual', ownerId, t });
      await db.run(`INSERT INTO lead_events (lead_id,type,to_status,note,user_id,created_at,meta) VALUES (?, 'created','nuevo',?,?,?,?)`, [id, 'Creado manualmente en el panel', user.id, t, metaJson({ k: 'manual' })]);
      return json(res, 201, await leadRow(await db.get('SELECT * FROM leads WHERE id=?', [id])));
    }
    const leadMatch = p.match(/^\/api\/leads\/(\d+)(\/status|\/note|\/tasks|\/spam|\/files\/(\d+))?$/);
    if (leadMatch) {
      const id = Number(leadMatch[1]);
      const sub = leadMatch[2] || '';
      const lead = await db.get('SELECT * FROM leads WHERE id=?', [id]);
      if (!lead) return E(404, 'not_found');

      if (!sub && method === 'GET') {
        const events = await db.all(`SELECT e.*, u.name user_name FROM lead_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.lead_id=? ORDER BY datetime(e.created_at) ASC, e.id ASC`, [id]);
        const files = await db.all('SELECT id,name,mime,size,created_at FROM lead_files WHERE lead_id=? ORDER BY id ASC', [id]);
        const tasks = (await db.all(`${TASK_SELECT} WHERE t.lead_id=? ORDER BY t.done ASC, t.due_at ASC`, [id])).map((r) => taskOut(r, now));
        return json(res, 200, { ...(await leadRow(lead)), events: localizeEvents(events, lang), files, tasks, photos: files.length });
      }
      if (sub.startsWith('/files/') && method === 'GET') {
        const fid = Number(leadMatch[3]);
        const f = await db.get('SELECT * FROM lead_files WHERE id=? AND lead_id=?', [fid, id]);
        if (!f) return E(404, 'not_found');
        let buf;
        try { buf = Buffer.from(String(f.data), 'base64'); } catch (e) { return E(500, 'bad_file'); }
        res.writeHead(200, {
          'Content-Type': PHOTO_TYPES.includes(f.mime) ? f.mime : 'application/octet-stream',
          'Content-Length': buf.length,
          'Cache-Control': 'private, max-age=3600',
          'Content-Disposition': `inline; filename="${String(f.name || 'photo').replace(/[^\w.\-]+/g, '_')}"`,
        });
        return res.end(buf);
      }
      if (!sub && method === 'PATCH') {
        const b = await readBody(req);
        const sets = [], vals = [];
        const setf = (f, v) => { sets.push(`${f}=?`); vals.push(v); };
        if ('name' in b) setf('name', cap(b.name, 120));
        if ('email' in b) { const em = cap(b.email, 160); if (em && !EMAIL_RE.test(em)) return E(400, 'invalid_email'); setf('email', em ? em.toLowerCase() : null); }
        if ('mobile' in b) setf('mobile', normMobile(b.mobile));
        if ('suburb' in b) setf('suburb', cap(b.suburb, 80));
        if ('postcode' in b) { const pc = cap(b.postcode, 10); if (pc && !/^\d{4}$/.test(pc)) return E(400, 'postcode'); setf('postcode', pc); }
        if ('city' in b) setf('city', cap(b.city, 80));
        if ('service' in b) setf('service', normKey(b.service, SERVICES));
        if ('items' in b) setf('items', cap(b.items, 4000));
        if ('condition' in b) setf('condition', normKey(b.condition, CONDITIONS));
        if ('days' in b) setf('days', normKey(b.days, DAYS));
        if ('time' in b) setf('time', normKey(b.time, TIMES));
        if ('addons' in b) setf('addons', normAddons(b.addons));
        if ('notes' in b) setf('notes', cap(b.notes, 4000));
        if ('owner_id' in b) {
          const oid = b.owner_id ? Number(b.owner_id) || null : null;
          if (oid && !(await db.get('SELECT id FROM users WHERE id=? AND active=1', [oid]))) return E(400, 'invalid_owner');
          setf('owner_id', oid);
        }
        if (sets.length) { vals.push(nowISO(), id); await db.run(`UPDATE leads SET ${sets.join(',')}, updated_at=? WHERE id=?`, vals); }
        return json(res, 200, await leadRow(await db.get('SELECT * FROM leads WHERE id=?', [id])));
      }
      if (sub === '/status' && method === 'PATCH') {
        const b = await readBody(req);
        const status = String(b.status || '');
        if (!STATUSES.includes(status)) return E(400, 'invalid_status');
        let loss = null;
        if (status === 'perdido') { loss = String(b.loss_reason || ''); if (!LOSS_REASONS[loss]) return E(400, 'loss_reason_required'); }
        const t = nowISO();
        const quotedAt = (status === 'cotizado' && !lead.quoted_at) ? t : (lead.quoted_at || null);
        await db.run('UPDATE leads SET status=?, loss_reason=?, quoted_at=?, updated_at=? WHERE id=?', [status, loss, quotedAt, t, id]);
        await db.run(`INSERT INTO lead_events (lead_id,type,from_status,to_status,loss_reason,user_id,created_at) VALUES (?, 'status',?,?,?,?,?)`, [id, lead.status, status, loss, user.id, t]);
        return json(res, 200, await leadRow(await db.get('SELECT * FROM leads WHERE id=?', [id])));
      }
      // Spam (reCAPTCHA): { spam:false } recupera el lead (vuelve al pipeline y sale el aviso de nuevo lead, como si acabara de llegar);
      // { spam:true } lo retira (sin correo). Admin y comercial. Idempotente: sin cambio no hay evento ni correo.
      if (sub === '/spam' && method === 'PATCH') {
        const b = await readBody(req);
        if (!('spam' in b)) return E(400, 'spam_required');
        const want = (b.spam === true || b.spam === 1 || b.spam === '1' || b.spam === 'true') ? 1 : 0;
        if (want === (Number(lead.spam) ? 1 : 0)) return json(res, 200, { ...(await leadRow(lead)), notification: 'none' });
        const t = nowISO();
        let notification = 'none';
        if (!want) {
          const why = lead.spam_reason || 'sin motivo';
          const sc = lead.recaptcha_score != null && !/^score /.test(why) ? ` · puntuación ${lead.recaptcha_score}` : '';
          await db.run('UPDATE leads SET spam=0, spam_reason=NULL, updated_at=? WHERE id=?', [t, id]);
          const origin = why === 'manual' ? 'lo habían marcado como spam a mano' : `reCAPTCHA lo había retenido: ${why}${sc}`;
          await db.run(`INSERT INTO lead_events (lead_id,type,note,user_id,created_at,meta) VALUES (?, 'spam',?,?,?,?)`,
            [id, `Marcado como NO spam: vuelve al pipeline (${origin})`, user.id, t, metaJson({ k: 'unspam', reason: why, score: lead.recaptcha_score == null ? null : lead.recaptcha_score })]);
          const files = await db.all('SELECT name,mime,data FROM lead_files WHERE lead_id=? ORDER BY id ASC', [id]);
          notification = await notifyNewLead({ base: baseUrl(req), id, lead, source: lead.source || 'quote', attribution: parseAttr(lead.attribution), files, createdAt: lead.created_at, why: 'recuperado de spam' });
          // Recordatorios que se cancelaron al marcarlo como spam: se vuelven a programar (los vencidos los manda el respaldo)
          for (const tk of await db.all('SELECT * FROM tasks WHERE lead_id=? AND done=0 AND emailed=0 AND due_at > ?', [id, t])) await scheduleTaskEmail(tk, baseUrl(req));
        } else {
          // Sus recordatorios ya programados en Resend se cancelan (no deben avisar de un lead fuera del pipeline)
          for (const tk of await db.all('SELECT * FROM tasks WHERE lead_id=? AND done=0 AND email_id IS NOT NULL AND due_at > ?', [id, t])) {
            await cancelTaskEmail(tk);
            await db.run('UPDATE tasks SET emailed=0 WHERE id=?', [tk.id]);
          }
          await db.run("UPDATE leads SET spam=1, spam_reason='manual', updated_at=? WHERE id=?", [t, id]);
          await db.run(`INSERT INTO lead_events (lead_id,type,note,user_id,created_at,meta) VALUES (?, 'spam',?,?,?,?)`,
            [id, 'Marcado como spam: retirado del pipeline y de las estadísticas', user.id, t, metaJson({ k: 'spam' })]);
        }
        return json(res, 200, { ...(await leadRow(await db.get('SELECT * FROM leads WHERE id=?', [id]))), notification });
      }
      if (sub === '/note' && method === 'POST') {
        const b = await readBody(req);
        const note = cap(b.note, 4000);
        if (!note) return E(400, 'note_empty');
        const t = nowISO();
        await db.run(`INSERT INTO lead_events (lead_id,type,note,user_id,created_at) VALUES (?, 'note',?,?,?)`, [id, note, user.id, t]);
        await db.run('UPDATE leads SET updated_at=? WHERE id=?', [t, id]);
        return json(res, 201, { ok: true });
      }
      if (sub === '/tasks' && method === 'POST') {
        const b = await readBody(req);
        const title = cap(b.title, 200);
        if (!title) return E(400, 'title_required');
        const due = toISO(b.due_at);
        if (!due) return E(400, 'due_invalid');
        let userId = null;
        if (b.user_id) { const u = await db.get('SELECT id FROM users WHERE id=? AND active=1', [Number(b.user_id)]); if (!u) return E(400, 'invalid_owner'); userId = u.id; }
        const t = nowISO();
        const r = await db.run('INSERT INTO tasks (lead_id,user_id,title,due_at,done,notified,emailed,created_by,created_at) VALUES (?,?,?,?,0,0,0,?,?)', [id, userId, title, due, user.id, t]);
        await db.run(`INSERT INTO lead_events (lead_id,type,note,user_id,created_at,meta) VALUES (?, 'task',?,?,?,?)`, [id, `Tarea: ${title} · vence ${fmtAdelaide(due)}`, user.id, t, metaJson({ k: 'task', title, due })]);
        await db.run('UPDATE leads SET updated_at=? WHERE id=?', [t, id]);
        const task = await db.get('SELECT * FROM tasks WHERE id=?', [r.lastInsertRowid]);
        await scheduleTaskEmail(task, baseUrl(req));
        const out = await db.get(`${TASK_SELECT} WHERE t.id=?`, [task.id]);
        return json(res, 201, taskOut(out, nowISO()));
      }
      if (!sub && method === 'DELETE') {
        if (!isAdmin) return E(403, 'forbidden');
        for (const tk of await db.all('SELECT * FROM tasks WHERE lead_id=?', [id])) await cancelTaskEmail(tk);
        await db.run('DELETE FROM tasks WHERE lead_id=?', [id]);
        await db.run('DELETE FROM lead_files WHERE lead_id=?', [id]);
        await db.run('DELETE FROM lead_events WHERE lead_id=?', [id]);
        await db.run('DELETE FROM leads WHERE id=?', [id]);
        return json(res, 200, { ok: true });
      }
      return E(405, 'method');
    }

    // ---- Tareas / recordatorios ----
    if (p === '/api/tasks/summary' && method === 'GET') {
      // Respaldo de recordatorios por correo (tareas vencidas con emailed=0)
      await processDueReminders(baseUrl(req));
      const rows = (await db.all(`${TASK_SELECT} WHERE t.done=0 AND (t.user_id=? OR t.user_id IS NULL) AND coalesce(l.spam,0)=0 ORDER BY t.due_at ASC LIMIT 500`, [user.id])).map((r) => taskOut(r, now));
      const soon = new Date(Date.now() + 60 * 60000).toISOString();
      const todayKey = dayKey(now);
      const overdue = rows.filter((r) => r.due_at <= now).length;
      const dueSoon = rows.filter((r) => r.due_at > now && r.due_at <= soon).length;
      const today = rows.filter((r) => r.due_at > now && dayKey(r.due_at) === todayKey).length;
      const due = rows.filter((r) => r.due_at <= now && !Number(r.notified)).slice(0, 10)
        .map((r) => ({ id: r.id, lead_id: r.lead_id, lead_name: r.lead_name, title: r.title, due_at: r.due_at }));
      for (const d of due) await db.run('UPDATE tasks SET notified=1 WHERE id=?', [d.id]);
      return json(res, 200, { overdue, dueSoon, today, due, badge: overdue + today, at: now });
    }
    if (p === '/api/tasks' && method === 'GET') {
      const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'mine';
      const stateQ = url.searchParams.get('state');
      const state = stateQ === 'done' ? 'done' : stateQ === 'all' ? 'all' : 'open';
      const leadId = Number(url.searchParams.get('lead_id')) || null;
      const clauses = [], args = [];
      if (scope === 'mine') { clauses.push('(t.user_id=? OR t.user_id IS NULL)'); args.push(user.id); }
      if (state === 'open') clauses.push('t.done=0'); else if (state === 'done') clauses.push('t.done=1');
      if (leadId) { clauses.push('t.lead_id=?'); args.push(leadId); }
      else clauses.push('coalesce(l.spam,0)=0');   // tareas de leads retenidos como spam: solo si se piden por lead_id
      const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
      const order = state === 'done' ? 'ORDER BY t.done_at DESC, t.due_at DESC' : 'ORDER BY t.done ASC, t.due_at ASC';
      const rows = await db.all(`${TASK_SELECT} ${where} ${order} LIMIT 500`, args);
      return json(res, 200, rows.map((r) => taskOut(r, now)));
    }
    const taskMatch = p.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch) {
      const id = Number(taskMatch[1]);
      const task = await db.get('SELECT * FROM tasks WHERE id=?', [id]);
      if (!task) return E(404, 'not_found');
      if (method === 'PATCH') {
        const b = await readBody(req);
        const sets = [], vals = [];
        let reschedule = false;
        if ('title' in b) { const ti = cap(b.title, 200); if (!ti) return E(400, 'title_required'); sets.push('title=?'); vals.push(ti); reschedule = true; }
        if ('due_at' in b) { const d = toISO(b.due_at); if (!d) return E(400, 'date_invalid'); if (d !== task.due_at) { sets.push('due_at=?'); vals.push(d); sets.push('notified=0'); reschedule = true; } }
        if ('user_id' in b) {
          let uid = null;
          if (b.user_id) { const u = await db.get('SELECT id FROM users WHERE id=? AND active=1', [Number(b.user_id)]); if (!u) return E(400, 'invalid_owner'); uid = u.id; }
          if (uid !== (task.user_id == null ? null : Number(task.user_id))) { sets.push('user_id=?'); vals.push(uid); reschedule = true; }
        }
        let doneChange = null;
        if ('done' in b) {
          const d = (b.done === true || b.done === 1 || b.done === '1' || b.done === 'true') ? 1 : 0;
          if (d !== Number(task.done)) {
            doneChange = d;
            sets.push('done=?'); vals.push(d);
            sets.push('done_at=?'); vals.push(d ? nowISO() : null);
            if (!d) { sets.push('notified=0'); }
          }
        }
        if (sets.length) { vals.push(id); await db.run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`, vals); }
        if (doneChange != null) {
          await db.run(`INSERT INTO lead_events (lead_id,type,note,user_id,created_at,meta) VALUES (?,?,?,?,?,?)`,
            [task.lead_id, doneChange ? 'task_done' : 'task', (doneChange ? 'Tarea hecha: ' : 'Tarea reabierta: ') + task.title, user.id, nowISO(),
              metaJson({ k: doneChange ? 'task_done' : 'task_reopen', title: task.title })]);
          await db.run('UPDATE leads SET updated_at=? WHERE id=?', [nowISO(), task.lead_id]);
        }
        const fresh = await db.get('SELECT * FROM tasks WHERE id=?', [id]);
        if (doneChange === 1) {
          await cancelTaskEmail(task);                        // hecha: cancela el programado si aún no venció
        } else if (reschedule || doneChange === 0) {
          await cancelTaskEmail(task);
          await db.run('UPDATE tasks SET emailed=0 WHERE id=?', [id]);
          await scheduleTaskEmail({ ...fresh, emailed: 0, email_id: null }, baseUrl(req));
        }
        const out = await db.get(`${TASK_SELECT} WHERE t.id=?`, [id]);
        return json(res, 200, taskOut(out, nowISO()));
      }
      if (method === 'DELETE') {
        await cancelTaskEmail(task);
        await db.run('DELETE FROM tasks WHERE id=?', [id]);
        return json(res, 200, { ok: true });
      }
      return E(405, 'method');
    }

    // ---- Usuarios (proyección mínima id,name para no-admin: la necesitan los selectores de responsable) ----
    const USER_COLS = 'id,name,email,role,active,lang,created_at';
    if (p === '/api/users' && method === 'GET') {
      const cols = isAdmin ? USER_COLS : 'id,name';
      return json(res, 200, await db.all(`SELECT ${cols} FROM users ${isAdmin ? '' : 'WHERE active=1'} ORDER BY id`));
    }
    if (p === '/api/users' && method === 'POST') {
      if (!isAdmin) return E(403, 'admin_only');
      const b = await readBody(req);
      const name = cap(b.name, 120), email = cap(b.email, 160), role = ROLES.includes(b.role) ? b.role : 'comercial';
      // Idioma del nuevo usuario (panel + correos): 'en' salvo que se elija otro
      const hasLang = b.lang != null && String(b.lang).trim() !== '';
      const ulang = hasLang ? normLang(b.lang) : 'en';
      if (!name || !email) return E(400, 'name_email_required');
      if (!EMAIL_RE.test(email)) return E(400, 'invalid_email');
      if (!ulang) return E(400, 'invalid_lang');
      const exists = await db.get('SELECT 1 FROM users WHERE lower(email)=lower(?)', [email]);
      if (exists) return E(409, 'email_taken');
      const r = await db.run('INSERT INTO users (name,email,role,active,created_at,lang) VALUES (?,?,?,1,?,?)', [name, email.toLowerCase(), role, nowISO(), ulang]);
      return json(res, 201, await db.get(`SELECT ${USER_COLS} FROM users WHERE id=?`, [r.lastInsertRowid]));
    }
    const userMatch = p.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && method === 'PATCH') {
      if (!isAdmin) return E(403, 'admin_only');
      const id = Number(userMatch[1]);
      const b = await readBody(req);
      const sets = [], vals = [];
      if ('name' in b) { const nm = cap(b.name, 120); if (!nm) return E(400, 'name_required'); sets.push('name=?'); vals.push(nm); }
      if ('email' in b) {
        const em = cap(b.email, 160);
        if (em) {
          if (!EMAIL_RE.test(em)) return E(400, 'invalid_email');
          const dup = await db.get('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?', [em, id]);
          if (dup) return E(409, 'email_taken');
          sets.push('email=?'); vals.push(em.toLowerCase());
        }
      }
      if ('role' in b && ROLES.includes(b.role)) { if (id === user.id && b.role !== 'admin') return E(400, 'self_demote'); sets.push('role=?'); vals.push(b.role); }
      if ('active' in b) { if (id === user.id && !b.active) return E(400, 'self_deactivate'); sets.push('active=?'); vals.push(b.active ? 1 : 0); }
      if ('lang' in b) { const l = normLang(b.lang); if (!l) return E(400, 'invalid_lang'); sets.push('lang=?'); vals.push(l); }
      if (sets.length) { vals.push(id); await db.run(`UPDATE users SET ${sets.join(',')} WHERE id=?`, vals); }
      const row = await db.get(`SELECT ${USER_COLS} FROM users WHERE id=?`, [id]);
      if (!row) return E(404, 'not_found');
      return json(res, 200, row);
    }
    const impMatch = p.match(/^\/api\/users\/(\d+)\/impersonate$/);
    if (impMatch && method === 'POST') {
      if (!isAdmin) return E(403, 'admin_only');
      const target = await db.get('SELECT * FROM users WHERE id=? AND active=1', [Number(impMatch[1])]);
      if (!target) return E(404, 'not_found');
      if (target.id === user.id) return E(400, 'self_impersonate');
      const sess = await sessionRow(req);
      const adminId = sess && sess.impersonator_id ? sess.impersonator_id : user.id;
      const sid = token(24);
      await db.run('INSERT INTO sessions (id,user_id,expires_at,created_at,impersonator_id) VALUES (?,?,?,?,?)', [sid, target.id, addDays(new Date(), 1).toISOString(), nowISO(), adminId]);
      res.setHeader('Set-Cookie', sidCookie(sid, 1));
      return json(res, 200, { ok: true, as: { id: target.id, name: target.name, role: target.role } });
    }

    if (p === '/api/stats' && method === 'GET') return json(res, 200, await buildStats(url.searchParams.get('month'), lang));

    // ---- Ajustes / integraciones (solo admin) ----
    if (p === '/api/settings' && method === 'GET') {
      if (!isAdmin) return E(403, 'admin_only');
      return json(res, 200, settingsOut(await getAllSettings()));
    }
    if (p === '/api/settings' && method === 'PUT') {
      if (!isAdmin) return E(403, 'admin_only');
      const b = await readBody(req, 2e6);
      // El secreto pegado en el campo de la clave de sitio se publicaría en /api/public/site-config: se rechaza sin guardar nada
      const secret = recaptchaSecret();
      if ('recaptcha_site_key' in b && secret && cleanSiteKey(b.recaptcha_site_key) === secret) {
        return E(400, 'recaptcha_secret_in_site_key');
      }
      for (const k of ALLOWED_SETTING_KEYS) if (k in b) {
        let v;
        if (k === 'snippets') v = JSON.stringify(parseSnippets(b[k]));
        else if (k === 'tracking_enabled') v = (b[k] === true || b[k] === 1 || b[k] === '1' || b[k] === 'true') ? '1' : '0';
        else if (k === 'notify_emails') v = String(b[k] == null ? '' : b[k]).split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)).join(',');
        else if (k === 'whatsapp_number') v = String(b[k] == null ? '' : b[k]).replace(/[^\d]/g, '').slice(0, 20);
        else if (k === 'recaptcha_site_key') v = cleanSiteKey(b[k]);
        else if (k === 'recaptcha_min_score') v = clampMinScore(b[k]);
        else if (/^custom_/.test(k)) v = String(b[k] == null ? '' : b[k]).slice(0, 50000);
        else v = String(b[k] == null ? '' : b[k]).trim().slice(0, 200);
        await db.run('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', [k, v, nowISO()]);
      }
      return json(res, 200, settingsOut(await getAllSettings()));
    }

    // ---- Redirecciones 301/302 (solo admin) ----
    if (p === '/api/redirects' && method === 'GET') {
      if (!isAdmin) return E(403, 'admin_only');
      return json(res, 200, await db.all('SELECT * FROM redirects ORDER BY id DESC'));
    }
    if (p === '/api/redirects' && method === 'POST') {
      if (!isAdmin) return E(403, 'admin_only');
      const b = await readBody(req);
      const from = normFrom(b.from_path), to = normTo(b.to_path);
      const code = Number(b.code) === 302 ? 302 : 301;
      if (!from || !to) return E(400, 'redirect_required');
      if (from === '/' || from.startsWith('/crm') || from.startsWith('/api')) return E(400, 'redirect_from_forbidden');
      if (from === to || from === to.replace(/\/+$/, '')) return E(400, 'redirect_same');
      if (await db.get('SELECT id FROM redirects WHERE from_path=?', [from])) return E(409, 'redirect_exists');
      const r = await db.run('INSERT INTO redirects (from_path,to_path,code,active,hits,created_at) VALUES (?,?,?,1,0,?)', [from, to, code, nowISO()]);
      return json(res, 201, await db.get('SELECT * FROM redirects WHERE id=?', [r.lastInsertRowid]));
    }
    const redirMatch = p.match(/^\/api\/redirects\/(\d+)$/);
    if (redirMatch) {
      if (!isAdmin) return E(403, 'admin_only');
      const id = Number(redirMatch[1]);
      if (method === 'DELETE') { await db.run('DELETE FROM redirects WHERE id=?', [id]); return json(res, 200, { ok: true }); }
      if (method === 'PATCH') {
        const b = await readBody(req);
        const sets = [], vals = [];
        if ('from_path' in b) {
          const from = normFrom(b.from_path);
          if (!from || from === '/' || from.startsWith('/crm') || from.startsWith('/api')) return E(400, 'redirect_from_invalid');
          if (await db.get('SELECT id FROM redirects WHERE from_path=? AND id<>?', [from, id])) return E(409, 'redirect_exists');
          sets.push('from_path=?'); vals.push(from);
        }
        if ('to_path' in b) { const to = normTo(b.to_path); if (!to) return E(400, 'redirect_to_required'); sets.push('to_path=?'); vals.push(to); }
        if ('code' in b) { sets.push('code=?'); vals.push(Number(b.code) === 302 ? 302 : 301); }
        if ('active' in b) { sets.push('active=?'); vals.push(b.active ? 1 : 0); }
        if (sets.length) { vals.push(id); await db.run(`UPDATE redirects SET ${sets.join(',')} WHERE id=?`, vals); }
        const row = await db.get('SELECT * FROM redirects WHERE id=?', [id]);
        if (!row) return E(404, 'not_found');
        return json(res, 200, row);
      }
      return E(405, 'method');
    }

    return E(404, 'no_route');
  }

  // ---- Estáticos ----
  if (method !== 'GET' && method !== 'HEAD') return json(res, 405, { error: 'method' });
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (isCrm) return serveStatic(res, p, WEBUI_DIR, true, gz, url);
  return serveStatic(res, p, SITE_DIR, false, gz, url);
}

// Rutas del proyecto que NUNCA se sirven como estáticos del sitio
const PRIVATE_DIRS = new Set(['lib', 'api', 'webui', 'data', 'node_modules']);
const PRIVATE_FILES = new Set(['package.json', 'package-lock.json', 'vercel.json', 'server.js']);
function isPrivatePath(rel) {
  const segs = rel.split('/').filter(Boolean);
  if (!segs.length) return false;
  if (PRIVATE_DIRS.has(segs[0].toLowerCase())) return true;
  for (const s of segs) if (s.startsWith('_') || s.startsWith('.')) return true;   // _src, _build.py, .git, .env, .gitignore, .nojekyll…
  const last = segs[segs.length - 1].toLowerCase();
  if (PRIVATE_FILES.has(last)) return true;
  if (/\.(md|py|pyc|db|db-wal|db-shm|log|env|mjs)$/.test(last)) return true;
  return false;
}

async function serveStatic(res, p, dir, spa, gz, url) {
  let rel;
  try { rel = decodeURIComponent(p); } catch (e) { return send(res, 400, 'Bad request'); }
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (rel.includes('\0')) return send(res, 400, 'Bad request');
  if (!spa && isPrivatePath(rel)) return serve404(res);
  const base = path.resolve(dir);
  let full = path.resolve(base, rel || '.');
  if (full !== base && !full.startsWith(base + path.sep)) return send(res, 403, 'forbidden');

  // Rutas limpias del sitio: carpeta con index.html → "/quote/" ; "/quote" → 301 "/quote/"
  let st = null;
  try { st = await fs.promises.stat(full); } catch (e) { st = null; }
  if (st && st.isDirectory()) {
    if (!spa && rel && !p.endsWith('/')) {
      res.writeHead(301, { Location: p + '/' + (url ? url.search : ''), 'Cache-Control': 'public, max-age=3600' });
      return res.end();
    }
    full = path.join(full, 'index.html');
    st = null;
    try { st = await fs.promises.stat(full); } catch (e) { st = null; }
  }
  if (!spa && st && /\/index\.html$/i.test(p)) {
    // /quote/index.html → /quote/  (canónica)
    res.writeHead(301, { Location: p.replace(/index\.html$/i, '') + (url ? url.search : ''), 'Cache-Control': 'public, max-age=3600' });
    return res.end();
  }
  let buf;
  try { buf = await fs.promises.readFile(full); }
  catch (e) {
    if (spa) {
      try { const idx = await fs.promises.readFile(path.join(base, 'index.html')); return sendFile(res, '.html', idx, gz, false); }
      catch (e2) { return send(res, 404, 'Not found'); }
    }
    return serve404(res);
  }
  const ext = path.extname(full).toLowerCase();
  return sendFile(res, ext, buf, gz, !spa);
}
function sendFile(res, ext, buf, gz, isSite) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.avif': 'image/avif',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf',
  };
  const ctype = types[ext] || 'application/octet-stream';
  const cache = /image|font|video/.test(ctype) ? 'public, max-age=2592000'
    : ext === '.html' ? 'no-cache'
      : isSite ? 'public, max-age=86400, stale-while-revalidate=604800'
        : 'no-cache';
  const textual = /text\/|javascript|json|xml|svg|manifest/.test(ctype);
  const headers = { 'Content-Type': ctype, 'Cache-Control': cache, 'Vary': 'Accept-Encoding' };
  if (gz && textual && buf.length > 512) {
    const z = zlib.gzipSync(buf);
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    return res.end(z);
  }
  res.writeHead(200, headers);
  res.end(buf);
}
async function serve404(res) {
  try {
    const buf = await fs.promises.readFile(path.join(SITE_DIR, '404.html'));
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch (e) { send(res, 404, 'Not found'); }
}
