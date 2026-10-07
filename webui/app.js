// ============================================================
//  Wyelee — panel del back office (vanilla JS, script clásico)
//  Arquitectura heredada de jkd-legacy-crm/public/app.js:
//  state · api() · toast · modal · hash routing · kanban por bloques · pager
// ============================================================
const $ = (s, r = document) => r.querySelector(s);
const root = $('#root');
const state = {
  me: null, meta: null, leads: [], users: [], settings: null,
  view: 'kanban', detailId: null,
  filter: 'all', fService: '', fCity: '', q: '', leadsPage: 1, kLimit: {},
  taskScope: 'mine', taskTab: 'open', summary: null,
  spamLeads: [], spamCount: 0,   // leads retenidos por reCAPTCHA (fuera del pipeline; filtro "Spam" de la tabla)
};

// ---------- constantes (única fuente en el frontend; lib/app.js es la del backend) ----------
// Las etiquetas visibles (estados, motivos, roles, orígenes, posiciones) salen del diccionario de i18n.js (es/en).
const STATUSES = ['nuevo', 'contactado', 'cotizado', 'agendado', 'ganado', 'perdido'];
const STATUS_COLORS = { nuevo: 'var(--blue)', contactado: 'var(--amber)', cotizado: 'var(--violet)', agendado: 'var(--teal)', ganado: 'var(--green)', perdido: 'var(--red)' };
const statusLabel = (s) => tk('status', s, s);
const STATUS_META = Object.fromEntries(STATUSES.map((s) => [s, { get label() { return statusLabel(s); }, color: STATUS_COLORS[s], cls: s }]));
const LOSS_REASONS = { no_responde: 'No responde', precio: 'Precio', fuera_zona: 'Fuera de zona', fecha: 'No hay fecha disponible', spam: 'Spam', otro: 'Otro' };
const SERVICES = { furniture: 'Furniture assembly', wardrobe: 'Wardrobe assembly', disassembly: 'Disassembly', kitchen: 'IKEA kitchen' };
const CONDITIONS = { new: 'New in the box', partial: 'Partially assembled', assembled: 'Already assembled' };
const ADDONS = { packaging: 'Packaging removal', anchoring: 'Wall anchoring', disassembly: 'Disassembly of old furniture' };
const DAYS = { weekdays: 'Weekdays', weekend: 'Weekend', either: 'Either' };
const TIMES = { morning: 'Morning', afternoon: 'Afternoon', either: 'Either' };
const srcLabel = (s) => (s ? tk('source', s, s) : '');       // Cotización / Contacto / Manual
const srcShort = (s) => (s ? tk('sourceShort', s, s) : '');  // etiqueta corta para la tarjeta del Kanban
const ROLES = ['admin', 'comercial'];
const SLA_HOURS = 24;            // promesa del sitio: cotización en 24 h
const DEFAULT_WA = '61432470313'; // número del negocio (settings.whatsapp_number)
const ADMIN_VIEWS = ['users', 'redirects', 'integrations'];
const VIEWS = ['kanban', 'leads', 'tasks', 'stats', 'users', 'redirects', 'integrations'];
const SNIPPET_POSITIONS = { head: 1, body_start: 1, body_end: 1 }; // claves válidas; la etiqueta es t('snip.pos.<clave>')
const snipPosLabel = (k) => tk('snip.pos', k, k);

const roleLabel = (r) => tk('role', r, r);
const isAdmin = () => !!(state.me && state.me.role === 'admin');
// El backend manda /api/meta con las claves; las etiquetas visibles salen del diccionario del panel (es/en).
const lossReasons = () => { const base = (state.meta && state.meta.lossReasons) || LOSS_REASONS; return Object.fromEntries(Object.keys(base).map((k) => [k, tk('loss', k, base[k])])); };
const services = () => (state.meta && state.meta.services) || SERVICES;
const lossLabel = (k) => lossReasons()[k] || k || '';
const svcLabel = (k) => services()[k] || '';

const ICON = {
  kanban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="9.5" y="3" width="5" height="12" rx="1"/><rect x="16" y="3" width="5" height="8" rx="1"/></svg>',
  leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3v18h18"/><rect x="7" y="11" width="3" height="6"/><rect x="12" y="7" width="3" height="10"/><rect x="17" y="13" width="3" height="4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  redirect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="15 10 20 15 15 20"/><path d="M4 4v7a4 4 0 0 0 4 4h12"/></svg>',
  integrations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>',
  out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  photo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4M12 16h.01"/></svg>',
};

// ---------- reCAPTCHA / spam ----------
// Motivos que guarda el backend (spam_reason) → texto del panel (diccionario spam.long.* / spam.short.*,
// la corta para la columna de la tabla y la larga para la ficha). 'score 0.1' se traduce aparte.
const SPAM_REASON_KEYS = ['no token', 'invalid token', 'action mismatch', 'hostname mismatch', 'no score', 'unverified limit', 'manual'];
function spamReasonLabel(r, short) {
  const s = String(r || '').trim();
  const m = s.match(/^score\s+([\d.]+)$/);
  if (m) return short ? t('spam.scoreShort') : t('spam.scoreLong', { s: m[1] });
  if (SPAM_REASON_KEYS.includes(s)) return t(`spam.${short ? 'short' : 'long'}.${s.replace(/\s+/g, '_')}`);
  return s || (short ? t('spam.noneShort') : t('spam.noneLong'));
}
function fmtScore(v) {
  if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return '';
  const n = Math.round(Number(v) * 100) / 100;
  return n % 1 === 0 ? n.toFixed(1) : String(n);
}

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const initials = (n) => (n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const leadName = (l) => String(l.name || '').trim() || t('lead.noName');
const firstName = (l) => (String(l.name || '').trim().split(/\s+/)[0]) || 'there';
const pad = (n) => String(n).padStart(2, '0');
// Fechas en el idioma del panel: 'es' (igual que siempre) / 'en-AU'. Zona horaria: la del navegador, como antes.
// En inglés: día sin cero ("6 Oct") y reloj de 24 h, igual que las horas de tareas y avisos ("21:09"), no "09:19 pm".
const dayOpt = () => (LANG === 'en' ? 'numeric' : '2-digit');
const clockOpt = () => (LANG === 'en' ? { hourCycle: 'h23' } : {});
function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString(dateLocale(), { day: dayOpt(), month: 'short', year: 'numeric' }); }
function fmtDateTime(iso) { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleString(dateLocale(), { day: dayOpt(), month: 'short', hour: '2-digit', minute: '2-digit', ...clockOpt() }); }
function fmtMonth(m) { if (!m) return '—'; const [y, mo] = String(m).split('-'); return new Date(y, mo - 1, 1).toLocaleDateString(dateLocale(), { month: 'short' }).replace('.', ''); }
function fmtMonthLong(m) { if (!m) return '—'; const [y, mo] = String(m).split('-'); const d = new Date(y, mo - 1, 1).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' }); return d.charAt(0).toUpperCase() + d.slice(1); }
function fmtSize(b) { b = Number(b) || 0; return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }
function fmtHours(h) { if (!isFinite(h)) return '—'; if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`; return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`; }
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
// "hoy 15:00" · "mañana 09:00" · "12 ene 10:00"  (en: "today 15:00" · "tomorrow 09:00" · "12 Jan 10:00")
function fmtDue(iso) {
  if (!iso) return '—';
  const d = new Date(iso), now = new Date(), tom = new Date(now); tom.setDate(now.getDate() + 1);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, now)) return t('due.today', { hm });
  if (sameDay(d, tom)) return t('due.tomorrow', { hm });
  return `${d.toLocaleDateString(dateLocale(), { day: dayOpt(), month: 'short' }).replace('.', '')} ${hm}`;
}
function toLocalInput(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function hoursOpen(l) { if (typeof l.hours_open === 'number') return l.hours_open; return (Date.now() - new Date(l.created_at).getTime()) / 36e5; }
// Badge de SLA: en 'nuevo' cuenta las horas que quedan de la promesa de 24 h; después, cuánto tardó la cotización.
function slaHTML(l) {
  if (l.status === 'nuevo') {
    const left = SLA_HOURS - hoursOpen(l);
    return left > 0
      ? `<span class="sla ok" title="${esc(t('sla.okTitle'))}">${t('sla.ok', { h: Math.max(1, Math.ceil(left)) })}</span>`
      : `<span class="sla late" title="${esc(t('sla.lateTitle'))}">${t('sla.late', { h: Math.floor(-left) })}</span>`;
  }
  if (l.quoted_at && l.created_at) {
    const h = (new Date(l.quoted_at) - new Date(l.created_at)) / 36e5;
    return `<span class="sla ${h <= SLA_HOURS ? 'ok' : 'late'}" title="${esc(t('sla.quotedTitle'))}">${t('sla.quoted', { t: fmtHours(h) })}</span>`;
  }
  return '';
}
// WhatsApp/SMS necesitan solo dígitos con prefijo país. Normaliza móviles AU (04xx → 614xx).
function waNumber(m) { let d = String(m || '').replace(/\D/g, ''); if (!d) return ''; if (d.startsWith('0')) d = '61' + d.slice(1); else if (!d.startsWith('61')) d = '61' + d; return d; }
function locLabel(l) { const a = [l.suburb, l.postcode].filter(Boolean).join(' '); const b = l.city || ''; return [a, b].filter(Boolean).join(', ') || '—'; }
function addonsArr(l) { const a = l.addons; if (Array.isArray(a)) return a; return String(a || '').split(',').map((x) => x.trim()).filter(Boolean); }
function chipService(l) {
  if (!l.service) return `<span class="chip-service contact">${l.source === 'contact' ? t('chip.contact') : t('chip.noService')}</span>`;
  return `<span class="chip-service ${esc(l.service)}">${esc(svcLabel(l.service) || l.service)}</span>`;
}
const leadSearchText = (l) => [l.name, l.email, l.mobile, l.suburb, l.postcode, l.city, l.items].map((x) => x || '').join(' ').toLowerCase();
// Usuarios asignables: la lista de /api/users (admin) o, si el comercial no puede verla, al menos yo mismo
function usersForSelect() { const list = state.users.slice(); if (state.me && !list.some((u) => u.id === state.me.id)) list.unshift({ id: state.me.id, name: state.me.name }); return list; }
function ownerOptions(selectedId) {
  return [`<option value="">${t('common.unassigned')}</option>`, ...usersForSelect().map((u) => `<option value="${u.id}" ${u.id === selectedId ? 'selected' : ''}>${esc(u.name)}</option>`)].join('');
}
const statusPill = (st) => `<span class="status-pill st-${esc(st)}"><i class="dot"></i>${esc(statusLabel(st))}</span>`;

const API_BASE = '/crm'; // el panel y su API cuelgan de /crm en el mismo dominio del sitio
const fileURL = (leadId, fid) => `${API_BASE}/api/leads/${Number(leadId)}/files/${Number(fid)}`;
async function api(method, path, body) {
  const opt = { method, headers: { 'X-Wy-Lang': LANG } }; // el servidor responde sus mensajes en el idioma del panel
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const res = await fetch(API_BASE + path, opt);
  if (res.status === 401) { state.me = null; stopPolling(); renderLogin(); throw new Error('unauth'); }
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  // El servidor responde { error: texto ya en el idioma del panel, code: clave estable } → se reconoce por code
  if (!res.ok) { const err = new Error((data && data.error) || res.statusText); err.code = (data && data.code) || ''; throw err; }
  return data;
}
let toastT;
function toast(msg, type = 'ok') {
  const el = $('#toast'); el.textContent = msg; el.className = `toast show ${type}`;
  clearTimeout(toastT); toastT = setTimeout(() => (el.className = 'toast'), 2600);
}

// ============================================================
//  IDIOMA DEL PANEL (es / en) — selector ES | EN en el login y en el pie del menú
// ============================================================
// Sin sesión manda localStorage/navegador (i18n.js); con sesión, users.lang (boot). Al cambiar: se guarda en
// localStorage y en el usuario (PATCH /api/me {lang}) y se repinta la vista actual sin recargar (el hash no cambia).
function langSwitchHTML(extraCls = '') {
  return `<div class="lang-switch ${extraCls}" role="group" aria-label="${esc(t('lang.label'))}">${LANGS.map((l) =>
    `<button type="button" data-lang="${l}" lang="${l}" title="${esc(t('lang.name.' + l))}" aria-pressed="${LANG === l}">${l.toUpperCase()}</button>`).join('')}</div>`;
}
function wireLangSwitch(scope) {
  (scope || document).querySelectorAll('.lang-switch [data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang, { persist: true, focus: true })));
}
function setLang(l, opts = {}) {
  if (!LANGS.includes(l)) return;
  const changed = l !== LANG;
  LANG = l; storeLang(l); document.documentElement.lang = l;
  if (!changed) return;
  if (state.me) {
    const sb = $('#sidebar'); const wasOpen = !!(sb && sb.classList.contains('open'));
    renderApp(); // repinta menú + vista actual (un modal abierto se cierra: se vuelve a abrir ya traducido)
    if (wasOpen) { $('#sidebar').classList.add('open'); $('#menu-btn').setAttribute('aria-expanded', 'true'); }
    repaintAlerts(); updateTitle();
    // PATCH /api/me guarda el idioma de la persona real (en «Entrar como», el del administrador, no el del suplantado).
    if (opts.persist) {
      api('PATCH', '/api/me', { lang: l })
        .then(() => { if (state.me) state.me.lang = l; })
        .catch((e) => { if (e.message !== 'unauth') console.warn(`[wyelee] ${t('lang.persistFail')}:`, e.message); });
    }
  } else renderLogin();
  if (opts.focus) { const b = document.querySelector(`.lang-switch [data-lang="${l}"]`); if (b) b.focus(); }
}

// ============================================================
//  LOGIN (solo magic link)
// ============================================================
let loginResult = null; // última respuesta de /api/auth/request (para repintarla al cambiar de idioma)
function magicResultHTML(r) {
  // Mensaje neutro siempre — no revela si el correo existe.
  let h = `<div class="magic-result"><b>${t('login.checkTitle')}</b><p>${t('login.checkBody')}</p>`;
  if (r && r.devLink) h += `<span class="devtag" style="display:block;margin-bottom:8px">${t('login.devTag')}</span><a class="btn btn-primary btn-sm" href="${esc(r.devLink)}">${t('login.enter')}</a>`;
  return h + '</div>';
}
function renderLogin() {
  stopPolling();
  document.title = t('app.title');
  const expired = location.hash === '#expired';
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const prevEmail = $('#email') ? $('#email').value : '';
  root.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      ${langSwitchHTML('login-lang')}
      <div class="login-logo"><img src="assets/logo.svg" alt="Wyelee"><span class="tag">${t('login.tag')}</span></div>
      <h1>${t('login.h1')}</h1>
      <p class="sub">${t('login.sub')}</p>
      ${expired ? `<div class="login-alert">${t('login.expired')}</div>` : ''}
      <form id="login-form">
        <div class="field">
          <label for="email">${t('login.emailLabel')}</label>
          <input type="email" id="email" placeholder="${esc(t('login.emailPh'))}" required autocomplete="email" value="${esc(prevEmail)}">
        </div>
        <button class="btn btn-primary" style="width:100%" type="submit">${t('login.submit')}</button>
      </form>
      <div id="magic-out">${loginResult ? magicResultHTML(loginResult) : ''}</div>
      ${local ? `<p class="login-note">${t('login.localNote')}</p>` : ''}
    </div>
  </div>`;
  wireLangSwitch(root);

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    const email = $('#email').value.trim();
    btn.disabled = true; btn.textContent = t('login.sending');
    try {
      const r = await api('POST', '/api/auth/request', { email });
      loginResult = r || {};
      $('#magic-out').innerHTML = magicResultHTML(loginResult);
    } catch (err) { toast(t('login.errRequest'), 'err'); }
    btn.disabled = false; btn.textContent = t('login.submit');
  });
}

// ============================================================
//  APP SHELL
// ============================================================
function renderApp() {
  const navItems = [
    ['kanban', t('nav.kanban'), ICON.kanban],
    ['leads', t('nav.leads'), ICON.leads],
    ['tasks', t('nav.tasks'), ICON.tasks],
    ['stats', t('nav.stats'), ICON.stats],
    ['users', t('nav.users'), ICON.users],
    ['redirects', t('nav.redirects'), ICON.redirect],
    ['integrations', t('nav.integrations'), ICON.integrations],
  ].filter(([k]) => isAdmin() || !ADMIN_VIEWS.includes(k));
  // Bloquea el acceso directo del comercial a vistas restringidas (y corrige el hash para que Atrás/F5 no vuelvan a intentarlo)
  if (!isAdmin() && ADMIN_VIEWS.includes(state.view)) {
    state.view = 'kanban';
    if (location.hash && location.hash !== '#kanban') { try { history.replaceState(null, '', '#kanban'); } catch (e) {} }
  }
  root.innerHTML = `
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="side-top">
        <a class="side-logo" href="#kanban"><img src="assets/logo.svg" alt="Wyelee"><span>${t('shell.panel')}</span></a>
        <button class="menu-btn" id="menu-btn" aria-label="${esc(t('shell.menu'))}" aria-expanded="false">${ICON.menu}</button>
      </div>
      <nav id="nav">
        ${navItems.map(([k, label, icon]) => `
          <button class="nav-item ${state.view === k || (state.view === 'leadDetail' && k === 'leads') ? 'active' : ''}" data-view="${k}">
            ${icon}<span>${label}</span>${k === 'leads' ? '<span class="badge" id="badge-leads"></span>' : k === 'tasks' ? '<span class="badge" id="badge-tasks"></span>' : ''}
          </button>`).join('')}
      </nav>
      <div class="side-foot">
        <div class="side-user">
          <span class="avatar">${initials(state.me.name)}</span>
          <span class="side-id"><span class="nm">${esc(state.me.name)}</span><span class="rl">${roleLabel(state.me.role)}</span></span>
          ${langSwitchHTML()}
        </div>
        <button class="nav-item" id="logout">${ICON.out}<span>${t('shell.logout')}</span></button>
      </div>
    </aside>
    <main class="main">
      ${state.me.impersonating ? `<div class="imp-bar">
        <span class="imp-msg">${ICON.eye} ${t('imp.msg', { name: esc(state.me.name), role: roleLabel(state.me.role) })}</span>
        <button class="btn btn-sm imp-back" id="stop-imp">${t('imp.back', { name: esc(state.me.impersonating.name) })}</button>
      </div>` : ''}
      <div id="view"></div>
    </main>
  </div>
  <div class="modal-bg" id="modal"></div>`;

  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item'); if (!b) return;
    $('#sidebar').classList.remove('open');
    // La vista vive en el hash → al recargar (F5) se mantiene y Atrás funciona
    if (location.hash === '#' + b.dataset.view) { state.view = b.dataset.view; renderApp(); }
    else location.hash = b.dataset.view;
  });
  $('#menu-btn').addEventListener('click', () => { const sb = $('#sidebar'); const open = sb.classList.toggle('open'); $('#menu-btn').setAttribute('aria-expanded', String(open)); });
  $('#logout').addEventListener('click', async () => { try { await api('POST', '/api/auth/logout'); } catch (e) {} location.reload(); });
  const stopImp = $('#stop-imp');
  if (stopImp) stopImp.addEventListener('click', async () => {
    try { await api('POST', '/api/auth/stop-impersonate'); location.reload(); }
    catch (e) { toast(t('imp.err'), 'err'); }
  });
  wireLangSwitch($('#sidebar'));

  $('#badge-leads').textContent = state.leads.length || '';
  paintTaskBadge();
  const views = { kanban: viewKanban, leads: viewLeads, tasks: viewTasks, stats: viewStats, users: viewUsers, redirects: viewRedirects, integrations: viewIntegrations, leadDetail: () => viewLeadDetail(state.detailId) };
  (views[state.view] || viewKanban)();
}

// ============================================================
//  KANBAN (Pipeline)
// ============================================================
async function viewKanban() {
  const v = $('#view');
  v.innerHTML = `
    <div class="topbar">
      <div><span class="ey">${t('kanban.ey')}</span><h1>${t('kanban.h1')}</h1></div>
      <div class="tools">
        <div class="search">${ICON.search}<input id="k-search" placeholder="${esc(t('kanban.searchPh'))}" value="${esc(state.q)}"></div>
        <button class="btn btn-ghost btn-sm" id="new-lead">${t('lead.newManual')}</button>
      </div>
    </div>
    <div class="kanban" id="kanban"></div>`;

  $('#new-lead').addEventListener('click', openNewLead);
  $('#k-search').addEventListener('input', (e) => { state.q = e.target.value; paintKanban(); });
  await loadLeads();
  paintKanban();
}

const KANBAN_BLOCK = 10; // los leads se cargan en bloques de 10 por columna

function paintKanban() {
  const board = $('#kanban'); if (!board) return;
  const q = state.q.trim().toLowerCase();
  const leads = state.leads.filter((l) => !q || leadSearchText(l).includes(q));
  board.innerHTML = STATUSES.map((st) => {
    const items = leads.filter((l) => l.status === st);
    const m = STATUS_META[st];
    return `
    <div class="col" data-status="${st}">
      <div class="col-head">
        <span class="col-dot" style="background:${m.color}"></span>
        <h3>${m.label}</h3><span class="cnt">${items.length}</span>
      </div>
      <div class="col-body" data-status="${st}">${colBodyHTML(st, items)}</div>
    </div>`;
  }).join('');
  wireDnD();
  board.querySelectorAll('.card').forEach((c) => c.addEventListener('click', () => { if (!c.dataset.dragged) openLead(Number(c.dataset.id)); }));
  wireKanbanMore(board, leads);
}

// Renderiza solo los primeros N (bloque) de una columna + botón "ver más"
function colBodyHTML(st, items) {
  if (!items.length) return `<div class="col-empty">—</div>`;
  const limit = state.kLimit[st] || KANBAN_BLOCK;
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;
  const more = rest > 0
    ? `<button class="col-more" data-status="${st}">${t('kanban.more', { k: Math.min(KANBAN_BLOCK, rest), n: rest })}</button>`
    : '';
  return shown.map(cardHTML).join('') + more;
}

// Botón "ver 10 más" + carga incremental al llegar al final del scroll de cada columna
function wireKanbanMore(board, leads) {
  const bump = (st) => {
    const total = leads.filter((l) => l.status === st).length;
    const cur = state.kLimit[st] || KANBAN_BLOCK;
    if (cur >= total) return;
    state.kLimit[st] = cur + KANBAN_BLOCK;
    const scrolls = {};
    board.querySelectorAll('.col-body').forEach((b) => (scrolls[b.dataset.status] = b.scrollTop));
    paintKanban();
    const nb = $('#kanban');
    nb && nb.querySelectorAll('.col-body').forEach((b) => { if (scrolls[b.dataset.status] != null) b.scrollTop = scrolls[b.dataset.status]; });
  };
  board.querySelectorAll('.col-more').forEach((btn) =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); bump(btn.dataset.status); }));
  board.querySelectorAll('.col-body').forEach((body) =>
    body.addEventListener('scroll', () => {
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 56) bump(body.dataset.status);
    }));
}

function cardHTML(l) {
  const loss = l.status === 'perdido' && l.loss_reason ? `<span class="chip loss" title="${esc(t('card.lossTitle', { r: lossLabel(l.loss_reason) }))}">${esc(lossLabel(l.loss_reason))}</span>` : '';
  const loc = [l.suburb, l.postcode].filter(Boolean).join(' ') || l.city || '—';
  const nt = l.next_task
    ? `<span class="tk-clock ${new Date(l.next_task.due_at) < new Date() ? 'late' : ''}" title="${esc(l.next_task.title)}">📞 ${fmtDue(l.next_task.due_at)}</span>`
    : '';
  return `
  <div class="card" draggable="true" data-id="${l.id}">
    <div class="nm" title="${esc(leadName(l))}">${esc(leadName(l))}</div>
    <div class="tags">${chipService(l)}${l.status === 'nuevo' ? slaHTML(l) : ''}${loss}</div>
    <div class="meta"><span title="${esc(locLabel(l))}">${esc(loc)}</span><span>${fmtDate(l.created_at)}</span>${l.photos ? `<span class="photos-n" title="${esc(t('card.photos', { n: l.photos }))}">${ICON.photo}${l.photos}</span>` : ''}</div>
    ${nt ? `<div class="meta">${nt}</div>` : ''}
    <div class="foot">
      <span class="own">${l.owner_name ? `<span class="av">${initials(l.owner_name)}</span><span class="own-nm">${esc(l.owner_name.split(' ')[0])}</span>` : `<span class="own-nm" style="color:var(--mute)">${t('common.unassigned')}</span>`}</span>
      <span class="src" title="${esc(srcLabel(l.source))}">${esc(srcShort(l.source))}</span>
    </div>
  </div>`;
}

function wireDnD() {
  let dragId = null;
  document.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('dragstart', (e) => { dragId = Number(card.dataset.id); card.classList.add('dragging'); card.dataset.dragged = '1'; e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); setTimeout(() => delete card.dataset.dragged, 50); });
  });
  document.querySelectorAll('.col').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const status = col.dataset.status;
      const lead = state.leads.find((l) => l.id === dragId);
      if (!lead || lead.status === status) return;
      if (status === 'perdido') openLossModal(async (reason) => { await changeStatus(dragId, 'perdido', reason); });
      else await changeStatus(dragId, status);
    });
  });
}

async function changeStatus(id, status, loss_reason) {
  try {
    await api('PATCH', `/api/leads/${id}/status`, { status, loss_reason });
    await loadLeads();
    if (state.view === 'kanban') paintKanban();
    else if (state.view === 'leads') paintLeads();
    else if (state.view === 'leadDetail') viewLeadDetail(id);
    toast(t('lead.moved', { s: statusLabel(status) }));
  } catch (e) { if (e.message !== 'unauth') toast(t('common.errUpdate'), 'err'); }
}

// ============================================================
//  LEADS (tabla)
// ============================================================
async function viewLeads() {
  const v = $('#view');
  v.innerHTML = `
    <div class="topbar">
      <div><span class="ey">${t('leads.ey')}</span><h1>${t('leads.h1')}</h1></div>
      <div class="tools">
        <div class="search">${ICON.search}<input id="l-search" placeholder="${esc(t('leads.searchPh'))}" value="${esc(state.q)}"></div>
        <button class="btn btn-ghost btn-sm" id="new-lead">${t('lead.newManual')}</button>
      </div>
    </div>
    <div class="filters" id="filters">
      ${['all', ...STATUSES].map((f) => `<button class="fbtn ${state.filter === f ? 'active' : ''}" data-f="${f}">${f === 'all' ? t('leads.all') : statusLabel(f)}</button>`).join('')}
      <span class="fsep" aria-hidden="true"></span>
      <button class="fbtn fbtn-spam ${state.filter === 'spam' ? 'active' : ''}" data-f="spam" title="${esc(t('leads.spamTitle'))}">${ICON.shield}${t('leads.spam')} <span class="n" id="spam-n">(${Number(state.spamCount) || 0})</span></button>
      <span class="spacer"></span>
      <select class="sel" id="fl-service" title="${esc(t('leads.fServiceTitle'))}"></select>
      <select class="sel" id="fl-city" title="${esc(t('leads.fCityTitle'))}"></select>
    </div>
    <div class="panel"><div id="leads-table"></div></div>`;

  $('#new-lead').addEventListener('click', openNewLead);
  $('#filters').addEventListener('click', async (e) => {
    const b = e.target.closest('.fbtn'); if (!b) return;
    state.filter = b.dataset.f; state.leadsPage = 1;
    $('#filters').querySelectorAll('.fbtn').forEach((x) => x.classList.toggle('active', x === b));
    if (state.filter === 'spam') { try { await loadSpamLeads(); } catch (err) { if (err.message === 'unauth') return; toast(t('leads.errSpam'), 'err'); } }
    paintFilterSelects();
    paintLeads();
  });
  $('#l-search').addEventListener('input', (e) => { state.q = e.target.value; state.leadsPage = 1; paintLeads(); });
  $('#fl-service').addEventListener('change', (e) => { state.fService = e.target.value; state.leadsPage = 1; paintLeads(); });
  $('#fl-city').addEventListener('change', (e) => { state.fCity = e.target.value; state.leadsPage = 1; paintLeads(); });
  await loadLeads();
  if (state.filter === 'spam') { try { await loadSpamLeads(); } catch (e) { if (e.message === 'unauth') return; } }
  paintFilterSelects();
  paintLeads();
}
const spamMode = () => state.filter === 'spam';

function paintFilterSelects() {
  const fs = $('#fl-service'), fc = $('#fl-city'); if (!fs || !fc) return;
  fs.innerHTML = [`<option value="">${t('leads.allServices')}</option>`, ...Object.entries(services()).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`), `<option value="contact">${t('leads.contactOnly')}</option>`].join('');
  fs.value = state.fService;
  const cities = [...new Set((spamMode() ? state.spamLeads : state.leads).map((l) => String(l.city || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  fc.innerHTML = [`<option value="">${t('leads.allCities')}</option>`, ...cities.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)].join('');
  fc.value = cities.includes(state.fCity) ? state.fCity : '';
  if (fc.value !== state.fCity) state.fCity = '';
}

const LEADS_PER_PAGE = 20; // tamaño de página de la tabla de leads

function filteredLeads() {
  const q = state.q.trim().toLowerCase();
  const spam = spamMode();
  return (spam ? state.spamLeads : state.leads).filter((l) =>
    (spam || state.filter === 'all' || l.status === state.filter) &&
    (!state.fService || (state.fService === 'contact' ? !l.service : l.service === state.fService)) &&
    (!state.fCity || String(l.city || '').trim() === state.fCity) &&
    (!q || leadSearchText(l).includes(q)));
}

function paintLeads() {
  const wrap = $('#leads-table'); if (!wrap) return;
  const spam = spamMode();
  const rows = filteredLeads();
  const spamNote = spam ? `<div class="spam-note">${ICON.shield}<p>${t('leads.spamNote')}</p></div>` : '';
  const sn = $('#spam-n'); if (sn) sn.textContent = `(${Number(state.spamCount) || 0})`;
  if (!rows.length) {
    wrap.innerHTML = spam
      ? `${spamNote}<div class="empty"><div class="big">${t('leads.spamEmptyBig')}</div>${state.q || state.fService || state.fCity ? t('leads.spamEmptyFiltered') : t('leads.spamEmpty')}</div>`
      : `<div class="empty"><div class="big">${t('leads.emptyBig')}</div>${t('leads.empty')}</div>`;
    return;
  }

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / LEADS_PER_PAGE));
  state.leadsPage = Math.min(Math.max(1, state.leadsPage), pages);
  const start = (state.leadsPage - 1) * LEADS_PER_PAGE;
  const pageRows = rows.slice(start, start + LEADS_PER_PAGE);
  // En el filtro Spam, la columna Estado muestra el motivo y la puntuación de reCAPTCHA
  const stateCell = (l) => spam
    ? `<span class="status-pill st-spam"><i class="dot"></i>${t('leads.spam')}</span>
       <span class="sub spam-why" title="${esc(spamReasonLabel(l.spam_reason))}">${esc(spamReasonLabel(l.spam_reason, true))}${fmtScore(l.recaptcha_score) ? ` · <b class="mono">${fmtScore(l.recaptcha_score)}</b>` : ''}</span>`
    : `${statusPill(l.status)}
        ${l.status === 'nuevo' ? `<span class="sub" style="margin-top:4px">${slaHTML(l)}</span>` : ''}
        ${l.status === 'perdido' && l.loss_reason ? `<span class="sub">${esc(lossLabel(l.loss_reason))}</span>` : ''}`;

  wrap.innerHTML = `${spamNote}<table><thead><tr>
    <th>${t('leads.th.name')}</th><th>${t('leads.th.contact')}</th><th>${t('leads.th.service')}</th><th>${t('leads.th.city')}</th><th>${spam ? t('leads.th.reason') : t('leads.th.status')}</th><th>${t('leads.th.photos')}</th><th>${spam ? t('leads.th.received') : t('leads.th.created')}</th><th>${t('leads.th.owner')}</th>
    </tr></thead><tbody>
    ${pageRows.map((l) => `<tr data-id="${l.id}"${spam ? ' class="row-spam"' : ''}>
      <td><span class="lead-nm">${esc(leadName(l))}</span><span class="sub">${esc(srcLabel(l.source))}</span></td>
      <td>${esc(l.mobile || '—')}<span class="sub">${esc(l.email || '')}</span></td>
      <td>${chipService(l)}</td>
      <td>${esc(l.city || '—')}<span class="sub">${esc([l.suburb, l.postcode].filter(Boolean).join(' '))}</span></td>
      <td>${stateCell(l)}</td>
      <td>${l.photos ? `<span class="photos-n">${ICON.photo}${l.photos}</span>` : '<span style="color:var(--mute)">—</span>'}</td>
      <td class="nowrap" title="${fmtDateTime(l.created_at)}">${fmtDate(l.created_at)}</td>
      <td>${l.owner_name ? esc(l.owner_name) : '<span style="color:var(--mute)">—</span>'}</td>
    </tr>`).join('')}
  </tbody></table>${leadsPager(state.leadsPage, pages, total, start, pageRows.length)}`;

  wrap.querySelectorAll('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => openLead(Number(tr.dataset.id))));
  const pager = wrap.querySelector('.pager');
  if (pager) pager.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-pg]'); if (!b || b.disabled) return;
    const v = b.dataset.pg;
    state.leadsPage = v === 'prev' ? state.leadsPage - 1 : v === 'next' ? state.leadsPage + 1 : Number(v);
    paintLeads();
  });
}

// Ventana de números de página (con elipsis cuando hay muchas)
function pageWindow(cur, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out = [1];
  let lo = Math.max(2, cur - 1), hi = Math.min(pages - 1, cur + 1);
  if (cur <= 3) { lo = 2; hi = 4; }
  if (cur >= pages - 2) { lo = pages - 3; hi = pages - 1; }
  if (lo > 2) out.push('…');
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 1) out.push('…');
  out.push(pages);
  return out;
}

function leadsPager(page, pages, total, start, count) {
  const from = total ? start + 1 : 0, to = start + count;
  const caption = `<span class="pager-count">${t('pager.showing', { from, to, total })}</span>`;
  if (pages <= 1) return `<div class="pager">${caption}</div>`;
  const nums = pageWindow(page, pages).map((n) => n === '…'
    ? `<span class="pager-gap">…</span>`
    : `<button class="pager-pg${n === page ? ' active' : ''}" data-pg="${n}">${n}</button>`).join('');
  return `<div class="pager">
    ${caption}
    <div class="pager-ctrl">
      <button class="pager-pg" data-pg="prev"${page === 1 ? ' disabled' : ''}>‹</button>
      ${nums}
      <button class="pager-pg" data-pg="next"${page === pages ? ' disabled' : ''}>›</button>
    </div>
  </div>`;
}

// ============================================================
//  FICHA DEL LEAD (#lead-<id>)
// ============================================================
function openLead(id) {
  if (location.hash === `#lead-${id}`) { state.detailId = id; state.view = 'leadDetail'; renderApp(); }
  else location.hash = `lead-${id}`;
}
function backToLeads() {
  if (location.hash === '#leads') { state.view = 'leads'; renderApp(); }
  else location.hash = 'leads';
}

// Plantillas en inglés para el cliente final (WhatsApp / SMS / correo) — el texto va SIEMPRE en inglés; solo la etiqueta se traduce
function msgTemplates(l) {
  const svc = (svcLabel(l.service) || 'assembly').toLowerCase();
  const where = l.suburb ? ` in ${l.suburb}` : '';
  const n = firstName(l);
  const phone = '+' + ((state.settings && state.settings.whatsapp_number) || DEFAULT_WA);
  return [
    { key: 'intro', label: t('tpl.intro'), text: `Hi ${n}, this is Wyelee about your ${svc} quote${where}. Thanks for getting in touch! When is a good time to call you so we can confirm the details and send your quote?` },
    { key: 'quote', label: t('tpl.quote'), text: `Hi ${n}, this is Wyelee. Here is your quote for the ${svc}${where}: $____. It includes assembly, clean-up and a final stability check. Reply YES to book a time, or let us know if you have any questions.` },
    { key: 'followup', label: t('tpl.followup'), text: `Hi ${n}, just following up on the ${svc} quote we sent. Would you like to lock in a date? We usually have availability this week. Thanks, Wyelee` },
    { key: 'confirm', label: t('tpl.confirm'), text: `Hi ${n}, this is Wyelee confirming your ${svc} appointment. We'll message you when we're on the way. If anything changes, you can reach us on ${phone}. See you soon!` },
  ];
}

async function loadLeadTasks(leadId) {
  // lead_id explícito: así también salen las tareas de un lead retenido como spam (la lista general las excluye)
  try { const all = await api('GET', `/api/tasks?scope=all&state=all&lead_id=${Number(leadId)}`); return (all || []).filter((x) => Number(x.lead_id) === Number(leadId)); }
  catch (e) { return []; }
}
function presetDue(k) {
  const d = new Date();
  if (k === '1h') d.setHours(d.getHours() + 1);
  else if (k === '3h') d.setHours(d.getHours() + 3);
  else if (k === 'tomorrow') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
  else if (k === '3d') { d.setDate(d.getDate() + 3); d.setHours(9, 0, 0, 0); }
  d.setSeconds(0, 0);
  return d;
}
async function createTask(leadId, body) {
  try { await api('POST', `/api/leads/${leadId}/tasks`, body); toast(t('task.created')); return true; }
  catch (e) { if (e.message !== 'unauth') toast(t('task.errCreate'), 'err'); return false; }
}

async function viewLeadDetail(id) {
  const v = $('#view');
  v.innerHTML = `<div class="empty">${t('common.loading')}</div>`;
  let lead;
  try { lead = await api('GET', `/api/leads/${id}`); }
  catch (e) {
    if (e.message === 'unauth') return;
    v.innerHTML = `<div class="empty"><div class="big">${t('detail.notFound')}</div><button class="btn btn-ghost btn-sm" id="back" style="margin-top:14px">${t('detail.back')}</button></div>`;
    $('#back').addEventListener('click', backToLeads); return;
  }
  let tasks = Array.isArray(lead.tasks) ? lead.tasks : await loadLeadTasks(id);
  const tpls = msgTemplates(lead);
  const files = lead.files || [];
  const isContact = !lead.service && lead.source === 'contact';
  const isSpam = Number(lead.spam) === 1;
  const manualSpam = lead.spam_reason === 'manual';
  const score = fmtScore(lead.recaptcha_score);

  v.innerHTML = `
    <div class="topbar">
      <div>
        <button class="backlink" id="back">${t('detail.back')}</button>
        <h1 style="margin-top:6px">${esc(leadName(lead))}</h1>
        <div class="detail-sub">
          ${isSpam ? `<span class="status-pill st-spam"><i class="dot"></i>${t('leads.spam')}</span>` : ''}
          ${statusPill(lead.status)}
          ${isSpam ? '' : slaHTML(lead)}
          ${chipService(lead)}
          <span class="sep">·</span><span>${esc(srcLabel(lead.source))}</span>
          <span class="sep">·</span><span>${t('detail.received', { d: fmtDateTime(lead.created_at) })}</span>
          <span class="sep">·</span><span class="mono">#${Number(lead.id)}</span>
        </div>
      </div>
      <div class="tools">${isSpam ? '' : `<button class="btn btn-ghost btn-sm" id="mark-spam" title="${esc(t('detail.markSpamTitle'))}">${t('detail.markSpam')}</button>${isAdmin() ? `<button class="btn btn-ghost btn-sm danger" id="del">${t('common.delete')}</button>` : ''}`}</div>
    </div>

    ${isSpam ? `<div class="spam-banner" role="alert">
      <span class="sb-ico">${ICON.shield}</span>
      <div class="sb-txt">
        <b>${manualSpam ? t('detail.spamManual') : t('detail.spamHeld', { r: esc(spamReasonLabel(lead.spam_reason, true).toLowerCase()) })}${score ? ` <span class="sb-score">${t('detail.score')} <span class="mono">${score}</span></span>` : ''}</b>
        <span>${manualSpam ? '' : t('detail.spamWhy', { r: esc(spamReasonLabel(lead.spam_reason)) })}${t('detail.spamBody')}</span>
      </div>
      <div class="sb-act">
        <button class="btn btn-primary btn-sm" id="spam-restore">${t('detail.notSpam')}</button>
        ${isAdmin() ? `<button class="btn btn-ghost btn-sm danger" id="spam-del">${t('common.delete')}</button>` : ''}
      </div>
    </div>` : ''}

    <div class="detail-grid">
      <div class="detail-main">
        ${quoteCardHTML(lead, isContact)}

        <div class="card-box">
          <div class="section-t">${t('detail.photosT')} ${files.length ? `<span class="cnt">${files.length}</span>` : ''}</div>
          ${galleryHTML(lead)}
        </div>

        ${editCardHTML(lead)}

        <div class="card-box">
          <div class="section-t">${t('detail.activity')}</div>
          <div class="timeline" id="timeline">${timelineHTML(lead)}</div>
          <div class="note-add">
            <input id="note" placeholder="${esc(t('detail.notePh'))}">
            <button class="btn btn-ghost btn-sm" id="note-btn">${t('detail.noteAdd')}</button>
          </div>
        </div>
      </div>

      <aside class="detail-side">
        <div class="card-box">
          <div class="section-t">${t('detail.statusT')}</div>
          <div class="status-select" id="status-sel">
            ${STATUSES.map((s) => `<button class="ss ${s} ${lead.status === s ? 'active' : ''}" data-s="${s}">${statusLabel(s)}</button>`).join('')}
          </div>
          ${lead.status === 'perdido' && lead.loss_reason ? `<p class="loss-note">${t('detail.lossNote', { r: esc(lossLabel(lead.loss_reason)) })}</p>` : ''}
          ${lead.quoted_at ? `<p class="help" style="margin-top:10px">${t('detail.quotedOn', { d: fmtDateTime(lead.quoted_at) })}</p>` : ''}
        </div>

        <div class="card-box">
          <div class="section-t">${t('detail.qaT')}</div>
          <div class="field"><label>${t('detail.qaTpl')}</label>
            <select id="qa-tpl">${tpls.map((tp, i) => `<option value="${i}">${esc(tp.label)}</option>`).join('')}</select>
          </div>
          <textarea id="qa-text" class="qa-text" rows="4">${esc(tpls[0].text)}</textarea>
          <div class="qa-grid">
            <a class="btn btn-primary btn-sm" id="qa-wa" target="_blank" rel="noopener noreferrer">WhatsApp</a>
            <a class="btn btn-ghost btn-sm" id="qa-sms">SMS</a>
            <a class="btn btn-ghost btn-sm" id="qa-call">${t('detail.qaCall')}</a>
            <a class="btn btn-ghost btn-sm" id="qa-mail">${t('detail.qaMail')}</a>
          </div>
          <button class="btn btn-ghost btn-sm" id="qa-copy" style="width:100%">${t('detail.qaCopy')}</button>
          ${!lead.mobile ? `<p class="help" style="margin-top:8px">${t('detail.noMobile')}</p>` : ''}
        </div>

        <div class="card-box" id="tasks-card">${leadTasksCardHTML(lead, tasks)}</div>

        <div class="card-box">
          <div class="section-t">${t('detail.attrT')}</div>
          ${attrHTML(lead)}
        </div>
      </aside>
    </div>`;

  $('#back').addEventListener('click', backToLeads);
  const delLead = async () => {
    if (!confirm(t('detail.confirmDelete'))) return;
    try { await api('DELETE', `/api/leads/${id}`); await loadLeads(); if (isSpam) await loadSpamLeads().catch(() => {}); toast(t('detail.deleted')); backToLeads(); }
    catch (e) { if (e.message !== 'unauth') toast(t('common.errDelete'), 'err'); }
  };
  [$('#del'), $('#spam-del')].forEach((b) => b && b.addEventListener('click', delLead));
  // Spam: recuperar (vuelve al pipeline + aviso por correo) o retirar a mano (sin correo)
  const setSpam = async (spam, btn) => {
    if (btn) btn.disabled = true;
    try {
      const r = await api('PATCH', `/api/leads/${id}/spam`, { spam });
      await loadLeads();
      if (state.filter === 'spam' || spam) await loadSpamLeads().catch(() => {});
      if (spam) toast(t('detail.markedSpam'));
      else {
        const n = r && r.notification;
        toast(n === 'sent' ? t('detail.recoveredSent')
          : n === 'failed' ? t('detail.recoveredFailed') : t('detail.recovered'), n === 'failed' ? 'err' : 'ok');
      }
      viewLeadDetail(id);
    } catch (e) { if (btn) btn.disabled = false; if (e.message !== 'unauth') toast(t('common.errUpdate'), 'err'); }
  };
  const restoreBtn = $('#spam-restore');
  if (restoreBtn) restoreBtn.addEventListener('click', () => setSpam(false, restoreBtn));
  const markBtn = $('#mark-spam');
  if (markBtn) markBtn.addEventListener('click', () => {
    if (!confirm(t('detail.confirmSpam'))) return;
    setSpam(true, markBtn);
  });
  $('#status-sel').addEventListener('click', (e) => {
    const b = e.target.closest('.ss'); if (!b) return;
    const s = b.dataset.s; if (s === lead.status) return;
    if (s === 'perdido') openLossModal((reason) => changeStatus(id, 'perdido', reason));
    else changeStatus(id, s);
  });

  // ----- acciones rápidas: la plantilla alimenta los enlaces de WhatsApp / SMS / correo -----
  const setHref = (a, href) => { if (!a) return; if (href) { a.href = href; a.classList.remove('disabled'); a.removeAttribute('aria-disabled'); } else { a.removeAttribute('href'); a.classList.add('disabled'); a.setAttribute('aria-disabled', 'true'); } };
  const syncQA = () => {
    const text = $('#qa-text').value;
    const wa = waNumber(lead.mobile);
    setHref($('#qa-wa'), wa ? `https://wa.me/${wa}?text=${encodeURIComponent(text)}` : '');
    setHref($('#qa-sms'), wa ? `sms:+${wa}?&body=${encodeURIComponent(text)}` : '');
    setHref($('#qa-call'), wa ? `tel:+${wa}` : '');
    setHref($('#qa-mail'), lead.email ? `mailto:${lead.email}?subject=${encodeURIComponent('Your Wyelee assembly quote')}&body=${encodeURIComponent(text)}` : '');
  };
  $('#qa-tpl').addEventListener('change', (e) => { $('#qa-text').value = tpls[Number(e.target.value)].text; syncQA(); });
  $('#qa-text').addEventListener('input', syncQA);
  $('#qa-copy').addEventListener('click', () => {
    navigator.clipboard.writeText($('#qa-text').value).then(() => toast(t('detail.copied'))).catch(() => toast(t('common.errCopy'), 'err'));
  });
  syncQA();

  // ----- galería -----
  v.querySelectorAll('.gallery .ph').forEach((b) => b.addEventListener('click', () => openViewer(lead, Number(b.dataset.ph))));

  // ----- edición inline -----
  $('#save').addEventListener('click', async () => {
    const val = (sel) => { const el = $(sel); return el ? el.value.trim() : ''; };
    const body = {
      name: val('#f-name'), email: val('#f-email'), mobile: val('#f-mobile'),
      suburb: val('#f-suburb'), postcode: val('#f-postcode'), city: val('#f-city'),
      service: val('#f-service') || null, condition: val('#f-condition') || null,
      days: val('#f-days') || null, time: val('#f-time') || null,
      addons: [...v.querySelectorAll('input[name="f-addon"]:checked')].map((c) => c.value).join(','),
      items: $('#f-items').value, notes: $('#f-notes').value,
      owner_id: val('#f-owner') ? Number(val('#f-owner')) : null,
    };
    if (!body.mobile && !body.email) { toast(t('detail.needContact'), 'err'); return; }
    if (body.postcode && !/^\d{4}$/.test(body.postcode)) { toast(t('detail.postcode4'), 'err'); return; }
    try { await api('PATCH', `/api/leads/${id}`, body); await loadLeads(); toast(t('detail.saved')); viewLeadDetail(id); }
    // validación del servidor (400 con code): su mensaje ya viene en el idioma del panel; lo demás → aviso genérico
    catch (e) { if (e.message !== 'unauth') toast(e.code && e.code !== 'server_error' ? e.message : t('common.errSave'), 'err'); }
  });

  // ----- notas -----
  const refreshTimeline = async () => {
    try { const fresh = await api('GET', `/api/leads/${id}`); lead.events = fresh.events; const tl = $('#timeline'); if (tl) tl.innerHTML = timelineHTML(lead); } catch (e) {}
  };
  const addNote = async () => {
    const note = $('#note').value.trim(); if (!note) return;
    try { await api('POST', `/api/leads/${id}/note`, { note }); $('#note').value = ''; toast(t('detail.noteAdded')); refreshTimeline(); }
    catch (e) { if (e.message !== 'unauth') toast(t('common.error'), 'err'); }
  };
  $('#note-btn').addEventListener('click', addNote);
  $('#note').addEventListener('keydown', (e) => { if (e.key === 'Enter') addNote(); });

  // ----- tareas del lead (delegación: la tarjeta se repinta tras cada cambio) -----
  const tasksCard = $('#tasks-card');
  const refreshTasks = async () => { tasks = await loadLeadTasks(id); if ($('#tasks-card')) $('#tasks-card').innerHTML = leadTasksCardHTML(lead, tasks); refreshTimeline(); pollTasks(); };
  tasksCard.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-preset]');
    if (p) {
      const ok = await createTask(id, { title: t('task.presetTitle', { name: firstName(lead) }), due_at: presetDue(p.dataset.preset).toISOString(), user_id: state.me.id });
      if (ok) await refreshTasks();
      return;
    }
    if (e.target.closest('#t-add')) {
      const title = $('#t-title').value.trim(), dueV = $('#t-due').value, uid = $('#t-user').value;
      if (!title) { toast(t('task.needTitle'), 'err'); return; }
      if (!dueV || isNaN(new Date(dueV))) { toast(t('task.needDue'), 'err'); return; }
      const ok = await createTask(id, { title, due_at: new Date(dueV).toISOString(), user_id: uid ? Number(uid) : null });
      if (ok) await refreshTasks();
      return;
    }
    const d = e.target.closest('[data-del]');
    if (d) {
      if (!confirm(t('task.confirmDelete'))) return;
      try { await api('DELETE', `/api/tasks/${Number(d.dataset.del)}`); removeAlert(d.dataset.del); toast(t('task.deleted')); }
      catch (err) { if (err.message !== 'unauth') toast(t('common.errDelete'), 'err'); }
      await refreshTasks();
    }
  });
  tasksCard.addEventListener('change', async (e) => {
    const cb = e.target.closest('input[data-task]'); if (!cb) return;
    try { await api('PATCH', `/api/tasks/${Number(cb.dataset.task)}`, { done: cb.checked }); if (cb.checked) removeAlert(cb.dataset.task); toast(cb.checked ? t('task.done') : t('task.reopened')); }
    catch (err) { if (err.message !== 'unauth') toast(t('common.errUpdate'), 'err'); }
    await refreshTasks();
  });
}

// Datos de la cotización (o el mensaje de contacto)
function quoteCardHTML(lead, isContact) {
  const tel = waNumber(lead.mobile);
  const addons = addonsArr(lead).map((k) => ADDONS[k] || k);
  const contactRows = `
    <div class="kv-row"><span class="k">${t('quote.mobile')}</span>${lead.mobile ? `<a class="v" href="tel:+${esc(tel)}">${esc(lead.mobile)}</a>` : '<span class="v">—</span>'}</div>
    <div class="kv-row"><span class="k">${t('quote.email')}</span>${lead.email ? `<a class="v" href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` : '<span class="v">—</span>'}</div>
    <div class="kv-row"><span class="k">${t('quote.location')}</span><span class="v">${esc(locLabel(lead))}</span></div>
    <div class="kv-row"><span class="k">${t('field.owner')}</span><span class="v">${lead.owner_name ? esc(lead.owner_name) : t('common.unassigned')}</span></div>
    <div class="kv-row"><span class="k">${t('quote.lastChange')}</span><span class="v">${fmtDateTime(lead.updated_at)}</span></div>`;
  if (isContact) {
    return `<div class="card-box">
      <div class="section-t">${t('quote.contactMsg')}</div>
      ${lead.notes ? `<div class="items-box" style="margin:0 0 14px">${esc(lead.notes)}</div>` : `<p class="muted" style="margin-bottom:14px">${t('quote.noMsg')}</p>`}
      <div class="kv">${contactRows}</div>
    </div>`;
  }
  return `<div class="card-box">
    <div class="section-t">${t('quote.request')}</div>
    <div class="quote-head">
      <div class="qh"><div class="k">${t('field.service')}</div><div class="v">${esc(svcLabel(lead.service) || lead.service || '—')}</div></div>
      <div class="qh"><div class="k">${t('field.condition')}</div><div class="v">${esc(CONDITIONS[lead.condition] || lead.condition || '—')}</div></div>
      <div class="qh"><div class="k">${t('field.days')}</div><div class="v">${esc(DAYS[lead.days] || lead.days || '—')}</div></div>
      <div class="qh"><div class="k">${t('field.slot')}</div><div class="v">${esc(TIMES[lead.time] || lead.time || '—')}</div></div>
    </div>
    <div class="kv">
      <div class="kv-row"><span class="k">${t('field.addons')}</span><span class="v">${addons.length ? addons.map((a) => esc(a)).join(' · ') : '—'}</span></div>
      ${contactRows}
    </div>
    <div class="section-t" style="margin-top:16px">${t('field.items')}</div>
    ${lead.items ? `<div class="items-box" style="margin-top:0">${esc(lead.items)}</div>` : `<p class="muted">${t('quote.noItems')}</p>`}
    ${lead.notes ? `<div class="section-t" style="margin-top:16px">${t('quote.customerNotes')}</div><div class="items-box" style="margin-top:0">${esc(lead.notes)}</div>` : ''}
  </div>`;
}

function galleryHTML(lead) {
  const files = lead.files || [];
  if (!files.length) return `<p class="muted">${t('gallery.none')}</p>`;
  return `<div class="gallery">${files.map((f, i) => `<button type="button" class="ph" data-ph="${i}" title="${esc(f.name || t('gallery.photo'))}"><img src="${fileURL(lead.id, f.id)}" alt="${esc(f.name || t('gallery.photo'))}" loading="lazy"></button>`).join('')}</div>`;
}

// Visor de fotos en modal (flechas ← → y Esc)
function openViewer(lead, idx) {
  const files = lead.files || []; if (!files.length) return;
  let i = Math.max(0, Math.min(idx, files.length - 1));
  const m = modal('', 'viewer');
  const paint = () => {
    const f = files[i], url = fileURL(lead.id, f.id);
    m.firstElementChild.innerHTML = `
      <button class="vw-x" id="vw-x" title="${esc(t('viewer.close'))}">×</button>
      ${files.length > 1 ? `<button class="vw-nav prev" id="vw-prev" title="${esc(t('viewer.prev'))}">‹</button><button class="vw-nav next" id="vw-next" title="${esc(t('viewer.next'))}">›</button>` : ''}
      <img src="${url}" alt="${esc(f.name || t('gallery.photo'))}">
      <div class="vw-cap"><span>${esc(f.name || t('gallery.photo'))} · ${fmtSize(f.size)} · ${i + 1}/${files.length}</span><a class="btn btn-ghost btn-sm" href="${url}" target="_blank" rel="noopener noreferrer">${t('viewer.newTab')}</a></div>`;
    $('#vw-x').addEventListener('click', closeModal);
    const prev = $('#vw-prev'), next = $('#vw-next');
    if (prev) prev.addEventListener('click', () => { i = (i - 1 + files.length) % files.length; paint(); });
    if (next) next.addEventListener('click', () => { i = (i + 1) % files.length; paint(); });
  };
  paint();
}

function editCardHTML(lead) {
  const opts = (dict, cur, none) => [`<option value="">${none}</option>`, ...Object.entries(dict).map(([k, v]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(v)}</option>`)].join('');
  const addons = addonsArr(lead);
  return `<div class="card-box">
    <div class="section-t">${t('edit.title')}</div>
    <div class="form-row-3">
      <div class="field"><label>${t('field.name')}</label><input id="f-name" value="${esc(lead.name || '')}"></div>
      <div class="field"><label>${t('field.email')}</label><input id="f-email" type="email" value="${esc(lead.email || '')}"></div>
      <div class="field"><label>${t('field.mobile')}</label><input id="f-mobile" value="${esc(lead.mobile || '')}"></div>
    </div>
    <div class="form-row-3">
      <div class="field"><label>Suburb</label><input id="f-suburb" value="${esc(lead.suburb || '')}"></div>
      <div class="field"><label>Postcode</label><input id="f-postcode" inputmode="numeric" maxlength="4" value="${esc(lead.postcode || '')}"></div>
      <div class="field"><label>${t('field.city')}</label><input id="f-city" value="${esc(lead.city || '')}"></div>
    </div>
    <div class="form-row-3">
      <div class="field"><label>${t('field.service')}</label><select id="f-service">${opts(services(), lead.service, t('field.contactOnly'))}</select></div>
      <div class="field"><label>${t('field.condition')}</label><select id="f-condition">${opts(CONDITIONS, lead.condition, '—')}</select></div>
      <div class="field"><label>${t('field.owner')}</label><select id="f-owner">${ownerOptions(lead.owner_id)}</select></div>
    </div>
    <div class="form-row">
      <div class="field"><label>${t('field.days')}</label><select id="f-days">${opts(DAYS, lead.days, '—')}</select></div>
      <div class="field"><label>${t('field.timeSlot')}</label><select id="f-time">${opts(TIMES, lead.time, '—')}</select></div>
    </div>
    <div class="field"><label>${t('field.addons')}</label><div class="checks">${Object.entries(ADDONS).map(([k, v]) => `<label><input type="checkbox" name="f-addon" value="${k}" ${addons.includes(k) ? 'checked' : ''}> ${esc(v)}</label>`).join('')}</div></div>
    <div class="field"><label>${t('field.itemsPerLine')}</label><textarea id="f-items">${esc(lead.items || '')}</textarea></div>
    <div class="field"><label>${t('edit.notesMsg')}</label><textarea id="f-notes">${esc(lead.notes || '')}</textarea></div>
    <button class="btn btn-primary btn-sm" id="save">${t('common.saveChanges')}</button>
  </div>`;
}

function leadTasksCardHTML(lead, tasks) {
  const byDue = (a, b) => new Date(a.due_at) - new Date(b.due_at);
  const open = tasks.filter((x) => !x.done).sort(byDue);
  const done = tasks.filter((x) => x.done).sort((a, b) => new Date(b.done_at || b.due_at) - new Date(a.done_at || a.due_at)).slice(0, 5);
  const userOpts = [`<option value="">${t('common.anyone')}</option>`, ...usersForSelect().map((u) => `<option value="${u.id}" ${u.id === state.me.id ? 'selected' : ''}>${esc(u.name)}</option>`)].join('');
  const item = (task) => {
    const overdue = !task.done && new Date(task.due_at) < new Date();
    return `<label class="task-item ${overdue ? 'overdue' : ''} ${task.done ? 'done' : ''}">
      <input type="checkbox" data-task="${Number(task.id)}" ${task.done ? 'checked' : ''}>
      <span class="tk-body"><span class="tk-title">${esc(task.title)}</span><span class="tk-due">${task.done ? t('ltasks.doneAt', { d: fmtDateTime(task.done_at || task.due_at) }) : t(overdue ? 'ltasks.wasDue' : 'ltasks.due', { d: fmtDue(task.due_at) })}${task.user_name ? ` · ${esc(task.user_name)}` : ''}</span></span>
      <button type="button" class="tk-del" data-del="${Number(task.id)}" title="${esc(t('common.delete'))}">×</button>
    </label>`;
  };
  return `
    <div class="section-t">${t('ltasks.title')} ${open.length ? `<span class="cnt">${t('ltasks.open', { n: open.length })}</span>` : ''}</div>
    <div class="task-presets">
      <button type="button" class="preset" data-preset="1h">${t('ltasks.p1h')}</button>
      <button type="button" class="preset" data-preset="3h">${t('ltasks.p3h')}</button>
      <button type="button" class="preset" data-preset="tomorrow">${t('ltasks.pTomorrow')}</button>
      <button type="button" class="preset" data-preset="3d">${t('ltasks.p3d')}</button>
    </div>
    <div class="field"><label>${t('ltasks.new')}</label><input id="t-title" placeholder="${esc(t('ltasks.newPh'))}"></div>
    <div class="form-row">
      <div class="field"><label>${t('ltasks.dueLabel')}</label><input id="t-due" type="datetime-local" value="${toLocalInput(presetDue('1h'))}"></div>
      <div class="field"><label>${t('field.owner')}</label><select id="t-user">${userOpts}</select></div>
    </div>
    <button class="btn btn-primary btn-sm" id="t-add" style="width:100%">${t('ltasks.create')}</button>
    <p class="help" style="margin-top:8px">${t('ltasks.help')}</p>
    <div class="task-list">
      ${open.map(item).join('')}${done.map(item).join('')}
      ${!tasks.length ? `<p class="muted">${t('ltasks.none')}</p>` : ''}
    </div>`;
}

// Atribución / origen del lead (página, referencia, UTMs, gclid…)
function attrHTML(lead) {
  let a; try { a = typeof lead.attribution === 'string' ? JSON.parse(lead.attribution || 'null') : lead.attribution; } catch (e) { a = null; }
  if (!a || typeof a !== 'object' || !Object.keys(a).length) return `<p class="muted">${t('attr.none')}</p>`;
  // Solo http(s):// se emite como enlace; cualquier otro esquema se muestra como texto (anti-XSS)
  const linkv = (u) => {
    const raw = String(u);
    return /^https?:\/\//i.test(raw)
      ? `<a class="v" href="${esc(raw)}" target="_blank" rel="noopener noreferrer" style="word-break:break-all">${esc(raw)}</a>`
      : `<span class="v" style="word-break:break-all">${esc(raw)}</span>`;
  };
  const row = (label, val, isLink) => (val ? `<div class="kv-row"><span class="k">${label}</span>${isLink ? linkv(val) : `<span class="v">${esc(val)}</span>`}</div>` : '');
  const known = ['page', 'referrer', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'msclkid', 'ttclid', 'user_agent'];
  const rows = [
    row(t('attr.page'), a.page), row(t('attr.referrer'), a.referrer, true),
    row('utm_source', a.utm_source), row('utm_medium', a.utm_medium), row('utm_campaign', a.utm_campaign),
    row('utm_term', a.utm_term), row('utm_content', a.utm_content),
    row('Google Click ID', a.gclid), row('Meta Click ID', a.fbclid), row('Microsoft Click ID', a.msclkid), row('TikTok Click ID', a.ttclid),
    ...Object.entries(a).filter(([k, v]) => !known.includes(k) && v && typeof v !== 'object').map(([k, v]) => row(esc(k), String(v))),
    row('reCAPTCHA', recaptchaLabel(a.recaptcha)),
  ].join('');
  return `<div class="kv">${rows || `<p class="muted">${t('attr.noneShort')}</p>`}</div>
    ${a.user_agent ? `<p class="help" style="margin-top:10px;word-break:break-word">${esc(a.user_agent)}</p>` : ''}`;
}

// Resultado de reCAPTCHA guardado en la atribución del lead ({ verdict, score, action })
function recaptchaLabel(rc) {
  if (!rc || typeof rc !== 'object' || !rc.verdict) return '';
  const sc = fmtScore(rc.score);
  const tail = (sc ? t('rc.score', { s: sc }) : '') + (rc.action ? t('rc.action', { a: rc.action }) : '');
  if (rc.verdict === 'ok') return t('rc.ok', { tail });
  if (rc.verdict === 'spam') return t('rc.spam', { tail });
  if (rc.verdict === 'unverified') return t('rc.unverified');
  if (rc.verdict === 'off') return t('rc.off');
  return String(rc.verdict);
}

function timelineHTML(lead) {
  return (lead.events || []).slice().reverse().map(eventHTML).join('') || `<p class="muted">${t('tl.none')}</p>`;
}
// Las notas automáticas (creado, tareas, spam) llegan ya traducidas por el servidor (X-Wy-Lang);
// las notas escritas a mano por el equipo se muestran tal cual.
function eventHTML(ev) {
  let txt = '', cls = ev.type;
  if (ev.type === 'created') txt = `${t('tl.created')}${ev.note ? ` · ${esc(ev.note)}` : ''}`;
  else if (ev.type === 'status') { cls = ev.to_status; txt = `${t('tl.moved', { s: esc(statusLabel(ev.to_status)) })}${ev.loss_reason ? ` — ${esc(lossLabel(ev.loss_reason))}` : ''}`; }
  else if (ev.type === 'note') txt = t('tl.note', { n: esc(ev.note) });
  else if (ev.type === 'task') txt = `⏰ ${esc(ev.note || t('tl.taskCreated'))}`;
  else if (ev.type === 'task_done') txt = `✓ ${esc(ev.note || t('tl.taskDone'))}`;
  else if (ev.type === 'spam') txt = esc(ev.note || t('tl.spamChange'));
  else txt = esc(ev.note || ev.type);
  return `<div class="tl ${esc(cls)}"><span class="dot"></span><div class="body"><div class="t">${txt}</div><div class="d">${fmtDateTime(ev.created_at)}${ev.user_name ? ' · ' + esc(ev.user_name) : ''}</div></div></div>`;
}

// ============================================================
//  MODALES — motivo de pérdida / lead manual / usuarios / fragmentos
// ============================================================
function modal(html, cls = '') { const m = $('#modal'); m.innerHTML = `<div class="modal ${cls}">${html}</div>`; m.classList.add('open'); return m; }
function closeModal() { const m = $('#modal'); if (m) { m.classList.remove('open'); m.innerHTML = ''; } }
document.addEventListener('keydown', (e) => {
  const m = $('#modal'); if (!m || !m.classList.contains('open')) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (m.querySelector('.viewer')) {
    if (e.key === 'ArrowLeft') { const b = $('#vw-prev'); if (b) b.click(); }
    if (e.key === 'ArrowRight') { const b = $('#vw-next'); if (b) b.click(); }
  }
});
document.addEventListener('click', (e) => { const m = $('#modal'); if (m && e.target === m && m.querySelector('.viewer')) closeModal(); });

function openLossModal(onConfirm) {
  const opts = Object.entries(lossReasons()).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
  modal(`
    <h2>${t('loss.title')}</h2>
    <p class="desc">${t('loss.desc')}</p>
    <div class="field"><label>${t('loss.reason')}</label><select id="loss-r">${opts}</select></div>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" id="loss-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary btn-sm" id="loss-ok">${t('loss.confirm')}</button>
    </div>`);
  $('#loss-cancel').addEventListener('click', () => { closeModal(); if (state.view === 'kanban') paintKanban(); });
  $('#loss-ok').addEventListener('click', () => { const r = $('#loss-r').value; closeModal(); onConfirm(r); });
}

function openNewLead() {
  const ownerOpts = usersForSelect().map((u) => `<option value="${u.id}" ${u.id === state.me.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
  modal(`
    <h2>${t('newLead.title')}</h2>
    <p class="desc">${t('newLead.desc')}</p>
    <div class="form-row">
      <div class="field"><label>${t('field.name')}</label><input id="n-name"></div>
      <div class="field"><label>${t('field.mobile')}</label><input id="n-mobile" placeholder="04xx xxx xxx"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>${t('field.email')}</label><input id="n-email" type="email"></div>
      <div class="field"><label>${t('field.service')}</label><select id="n-service"><option value="">${t('field.contactOnly')}</option>${Object.entries(services()).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></div>
    </div>
    <div class="form-row-3">
      <div class="field"><label>Suburb</label><input id="n-suburb"></div>
      <div class="field"><label>Postcode</label><input id="n-postcode" inputmode="numeric" maxlength="4"></div>
      <div class="field"><label>${t('field.city')}</label><input id="n-city" placeholder="Adelaide"></div>
    </div>
    <div class="field"><label>${t('field.itemsPerLine')}</label><textarea id="n-items" rows="3"></textarea></div>
    <div class="field"><label>${t('field.notes')}</label><textarea id="n-notes" rows="2"></textarea></div>
    <div class="field"><label>${t('field.owner')}</label><select id="n-owner">${ownerOpts}</select></div>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" id="n-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary btn-sm" id="n-ok">${t('newLead.create')}</button>
    </div>`, 'wide');
  $('#n-cancel').addEventListener('click', closeModal);
  $('#n-ok').addEventListener('click', async () => {
    const g = (id) => $(id).value.trim();
    const body = { name: g('#n-name'), mobile: g('#n-mobile'), email: g('#n-email'), service: g('#n-service') || null, suburb: g('#n-suburb'), postcode: g('#n-postcode'), city: g('#n-city'), items: $('#n-items').value, notes: $('#n-notes').value, owner_id: Number($('#n-owner').value) || null, source: 'manual' };
    if (!body.name) { toast(t('newLead.needName'), 'err'); return; }
    if (!body.mobile && !body.email) { toast(t('detail.needContact'), 'err'); return; }
    if (body.postcode && !/^\d{4}$/.test(body.postcode)) { toast(t('detail.postcode4'), 'err'); return; }
    try { await api('POST', '/api/leads', body); closeModal(); await loadLeads(); if (state.view === 'kanban') paintKanban(); else if (state.view === 'leads') { paintFilterSelects(); paintLeads(); } toast(t('newLead.created')); }
    catch (e) { if (e.message !== 'unauth') toast(t('common.errCreate'), 'err'); }
  });
}

// ============================================================
//  TAREAS — vista #tasks + avisos
// ============================================================
async function viewTasks() {
  const v = $('#view');
  const canNotify = 'Notification' in window;
  const granted = canNotify && Notification.permission === 'granted';
  v.innerHTML = `
    <div class="topbar">
      <div><span class="ey">${t('tasks.ey')}</span><h1>${t('tasks.h1')}</h1></div>
      <div class="tools">
        <div class="seg" id="tk-scope"><button data-s="mine" class="${state.taskScope === 'mine' ? 'active' : ''}">${t('tasks.mine')}</button><button data-s="all" class="${state.taskScope === 'all' ? 'active' : ''}">${t('tasks.all')}</button></div>
        <div class="seg" id="tk-tab"><button data-t="open" class="${state.taskTab === 'open' ? 'active' : ''}">${t('tasks.open')}</button><button data-t="done" class="${state.taskTab === 'done' ? 'active' : ''}">${t('tasks.doneTab')}</button></div>
        ${canNotify ? (granted ? `<span class="pill-ok">${t('tasks.notifOn')}</span>` : `<button class="btn btn-ghost btn-sm" id="tk-notif">${t('tasks.notifTurnOn')}</button>`) : ''}
      </div>
    </div>
    <p class="help" style="margin:-10px 0 18px;max-width:78ch">${t('tasks.help')}</p>
    <div id="tasks-wrap"><div class="empty">${t('common.loading')}</div></div>`;

  $('#tk-scope').addEventListener('click', (e) => { const b = e.target.closest('button[data-s]'); if (!b) return; state.taskScope = b.dataset.s; $('#tk-scope').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); paintTasksView(); });
  $('#tk-tab').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (!b) return; state.taskTab = b.dataset.t; $('#tk-tab').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b)); paintTasksView(); });
  const nb = $('#tk-notif');
  if (nb) nb.addEventListener('click', async () => {
    try {
      const p = await Notification.requestPermission();
      if (p === 'granted') { toast(t('tasks.notifGranted')); viewTasks(); }
      else toast(t('tasks.notifDenied'), 'err');
    } catch (e) { toast(t('tasks.notifErr'), 'err'); }
  });
  wireTasksWrap($('#tasks-wrap'));
  await paintTasksView();
}

async function paintTasksView() {
  const wrap = $('#tasks-wrap'); if (!wrap) return;
  let rows = [];
  try { rows = (await api('GET', `/api/tasks?scope=${state.taskScope}&state=${state.taskTab}`)) || []; }
  catch (e) { if (e.message !== 'unauth') wrap.innerHTML = `<div class="empty">${t('tasks.errLoad')}</div>`; return; }
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty"><div class="big">${state.taskTab === 'done' ? t('tasks.emptyDoneBig') : t('tasks.emptyOpenBig')}</div>${state.taskTab === 'done' ? t('tasks.emptyDone') : t('tasks.emptyOpen')}</div>`;
    return;
  }
  const now = new Date();
  const dateLab = (iso) => { const d = new Date(iso); const tom = new Date(now); tom.setDate(now.getDate() + 1); return sameDay(d, now) ? t('day.today') : sameDay(d, tom) ? t('day.tomorrow') : d.toLocaleDateString(dateLocale(), { day: dayOpt(), month: 'short' }).replace('.', ''); };
  const rowHTML = (task) => {
    const d = new Date(task.due_at);
    const overdue = !task.done && (task.overdue || d < now);
    return `<div class="task-row ${overdue ? 'overdue' : ''}">
      <div class="tk-when"><b>${pad(d.getHours())}:${pad(d.getMinutes())}</b><span>${task.done ? fmtDate(task.done_at || task.due_at) : dateLab(task.due_at)}</span></div>
      <div class="tk-body">
        <div class="tk-title">${esc(task.title)}</div>
        <div class="tk-meta"><a href="#lead-${Number(task.lead_id)}">${esc(task.lead_name || `Lead #${task.lead_id}`)}</a>${task.lead_mobile ? ` · ${esc(task.lead_mobile)}` : ''} · ${task.user_name ? esc(task.user_name) : t('common.anyone')}${task.done ? t('tasks.doneAt', { d: fmtDateTime(task.done_at) }) : ''}</div>
      </div>
      <div class="tk-actions">
        <button class="btn btn-ghost btn-sm" data-go="${Number(task.lead_id)}">${t('tasks.viewLead')}</button>
        ${task.done ? `<button class="btn btn-ghost btn-sm" data-reopen="${Number(task.id)}">${t('tasks.reopen')}</button>` : `<button class="btn btn-primary btn-sm" data-done="${Number(task.id)}">${t('tasks.markDone')}</button>`}
      </div>
    </div>`;
  };
  const group = (title, list, cls) => list.length ? `<div class="task-group ${cls}"><h3>${title} <span class="cnt">${list.length}</span></h3>${list.map(rowHTML).join('')}</div>` : '';

  if (state.taskTab === 'done') {
    wrap.innerHTML = group(t('tasks.gDone'), rows.slice().sort((a, b) => new Date(b.done_at || b.due_at) - new Date(a.done_at || a.due_at)), 'done');
  } else {
    const g = { late: [], today: [], soon: [] };
    rows.forEach((task) => { const d = new Date(task.due_at); if (task.overdue || d < now) g.late.push(task); else if (sameDay(d, now)) g.today.push(task); else g.soon.push(task); });
    wrap.innerHTML = group(t('tasks.gLate'), g.late, 'late') + group(t('tasks.gToday'), g.today, 'today') + group(t('tasks.gSoon'), g.soon, 'soon');
  }
}

// Delegación única sobre #tasks-wrap (la lista se repinta con innerHTML, el contenedor permanece)
function wireTasksWrap(wrap) {
  wrap.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]'); if (go) { openLead(Number(go.dataset.go)); return; }
    const dn = e.target.closest('[data-done]'); if (dn) { dn.disabled = true; try { await completeTask(Number(dn.dataset.done)); } catch (err) { dn.disabled = false; if (err.message !== 'unauth') toast(t('common.errUpdate'), 'err'); } return; }
    const ro = e.target.closest('[data-reopen]'); if (ro) { try { await api('PATCH', `/api/tasks/${Number(ro.dataset.reopen)}`, { done: false }); toast(t('task.reopened')); paintTasksView(); pollTasks(); } catch (err) { if (err.message !== 'unauth') toast(t('tasks.errReopen'), 'err'); } }
  });
}

// Marca hecha desde un aviso o desde la vista de tareas y refresca lo que esté en pantalla
async function completeTask(taskId) {
  await api('PATCH', `/api/tasks/${taskId}`, { done: true });
  removeAlert(taskId);
  toast(t('task.done'));
  pollTasks();
  if (state.view === 'tasks') paintTasksView();
  else if (state.view === 'leadDetail') viewLeadDetail(state.detailId);
  else if (state.view === 'kanban') { await loadLeads(); paintKanban(); }
}

// ----- sondeo de /api/tasks/summary (al entrar y cada 60 s) -----
let pollT = null;
function startPolling() { stopPolling(); pollTasks(); pollT = setInterval(pollTasks, 60000); }
function stopPolling() { if (pollT) clearInterval(pollT); pollT = null; }
async function pollTasks() {
  if (!state.me) return;
  let s; try { s = await api('GET', '/api/tasks/summary'); } catch (e) { return; }
  if (!s) return;
  state.summary = s;
  paintTaskBadge();
  (s.due || []).forEach(showTaskAlert);
  updateTitle();
}
function paintTaskBadge() {
  const b = $('#badge-tasks'); if (!b) return;
  const s = state.summary || {};
  const n = (Number(s.overdue) || 0) + (Number(s.today) || 0);
  b.textContent = n || '';
  b.classList.toggle('hot', (Number(s.overdue) || 0) > 0);
}
function updateTitle() {
  const n = (state.summary && Number(state.summary.overdue)) || 0;
  document.title = n ? `(${n}) Wyelee CRM` : t('app.title');
}
// Aviso apilable en la esquina superior derecha; no desaparece solo
const alertTasks = new Map(); // id → tarea, para repintar los avisos abiertos al cambiar de idioma
function fillTaskAlert(el, task) {
  el.innerHTML = `
    <div class="at-head">
      <span class="at-ico">⏰</span>
      <div class="at-txt"><b>${esc(task.title)}</b><span>${esc(task.lead_name || `Lead #${task.lead_id}`)} · ${fmtDue(task.due_at)}</span></div>
      <button class="at-x" title="${esc(t('alert.dismiss'))}">×</button>
    </div>
    <div class="at-actions">
      <button class="btn btn-ghost btn-sm" data-go>${t('tasks.viewLead')}</button>
      <button class="btn btn-primary btn-sm" data-done>${t('tasks.markDone')}</button>
    </div>`;
  el.querySelector('.at-x').addEventListener('click', () => { el.remove(); alertTasks.delete(Number(task.id)); });
  el.querySelector('[data-go]').addEventListener('click', () => openLead(Number(task.lead_id)));
  el.querySelector('[data-done]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await completeTask(Number(task.id)); } catch (err) { e.target.disabled = false; if (err.message !== 'unauth') toast(t('alert.errMark'), 'err'); }
  });
}
function showTaskAlert(task) {
  const host = $('#alerts'); if (!host || !task) return;
  if (host.querySelector(`[data-task="${Number(task.id)}"]`)) return;
  const el = document.createElement('div');
  el.className = 'alert-task'; el.dataset.task = String(Number(task.id));
  alertTasks.set(Number(task.id), task);
  fillTaskAlert(el, task);
  host.appendChild(el);
  // Notificación del sistema si el usuario la activó en la vista Tareas
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      const n = new Notification(`⏰ ${task.title}`, { body: `${task.lead_name || 'Lead'} · ${fmtDue(task.due_at)}`, tag: `wy-task-${task.id}`, icon: `${location.origin}/crm/assets/favicon.png` });
      n.onclick = () => { try { window.focus(); } catch (e2) {} location.hash = `lead-${Number(task.lead_id)}`; n.close(); };
    } catch (e) {}
  }
}
function repaintAlerts() {
  document.querySelectorAll('#alerts .alert-task').forEach((el) => { const task = alertTasks.get(Number(el.dataset.task)); if (task) fillTaskAlert(el, task); });
}
function removeAlert(taskId) { const el = $(`#alerts [data-task="${Number(taskId)}"]`); if (el) el.remove(); alertTasks.delete(Number(taskId)); }

// ============================================================
//  USUARIOS (solo admin)
// ============================================================
async function viewUsers() {
  const v = $('#view');
  try { state.users = await api('GET', '/api/users'); }
  catch (e) { if (e.message !== 'unauth') v.innerHTML = `<div class="empty"><div class="big">${t('common.restricted')}</div>${t('users.restricted')}</div>`; return; }
  const admin = isAdmin();
  v.innerHTML = `
    <div class="topbar">
      <div><span class="ey">${t('users.ey')}</span><h1>${t('users.h1')}</h1></div>
      <div class="tools">${admin ? `<button class="btn btn-primary btn-sm" id="new-user">${t('users.new')}</button>` : ''}</div>
    </div>
    <p class="help" style="margin:-10px 0 16px">${t('users.help')}</p>
    <div class="panel"><table><thead><tr>
      <th>${t('users.th.user')}</th><th>${t('users.th.email')}</th><th>${t('users.th.role')}</th><th>${t('users.th.lang')}</th><th>${t('users.th.status')}</th>${admin ? '<th></th>' : ''}
    </tr></thead><tbody>
    ${state.users.map((u) => `<tr>
      <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="width:30px;height:30px;font-size:.72rem">${initials(u.name)}</span><span class="lead-nm" style="font-size:.92rem">${esc(u.name)}</span></div></td>
      <td>${esc(u.email)}</td>
      <td><span class="status-pill ${u.role === 'admin' ? 'st-ganado' : 'st-nuevo'}">${roleLabel(u.role)}</span></td>
      <td>${LANGS.includes(u.lang) ? `<span class="lang-tag" lang="${u.lang}" title="${esc(t('lang.name.' + u.lang))}">${u.lang.toUpperCase()}</span>` : '<span style="color:var(--mute)">—</span>'}</td>
      <td>${u.active ? `<span style="color:var(--green-text);font-weight:700">● ${t('common.active')}</span>` : `<span style="color:var(--mute)">○ ${t('common.inactive')}</span>`}</td>
      ${admin ? `<td style="text-align:right;white-space:nowrap">
        ${u.id !== state.me.id && u.active ? `<button class="btn btn-ghost btn-sm" data-imp="${u.id}">${t('users.impersonate')}</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-edit="${u.id}">${t('common.edit')}</button>
      </td>` : ''}
    </tr>`).join('')}
    </tbody></table></div>`;

  if (admin) {
    $('#new-user').addEventListener('click', openNewUser);
    v.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEditUser(state.users.find((u) => u.id === Number(b.dataset.edit)))));
    v.querySelectorAll('[data-imp]').forEach((b) => b.addEventListener('click', async () => {
      const u = state.users.find((x) => x.id === Number(b.dataset.imp));
      if (!u || !confirm(t('users.confirmImp', { name: u.name, role: roleLabel(u.role) }))) return;
      try { await api('POST', `/api/users/${u.id}/impersonate`); location.reload(); }
      catch (e) { if (e.message !== 'unauth') toast(t('users.errImp'), 'err'); }
    }));
  }
}

// Idioma del usuario (users.lang): panel + correos que recibe. Los nombres van en su propio idioma.
const langOptions = (cur) => LANGS.map((l) => `<option value="${l}" lang="${l}" ${cur === l ? 'selected' : ''}>${esc(t('lang.name.' + l))}</option>`).join('');

function openNewUser() {
  modal(`
    <h2>${t('users.createT')}</h2>
    <p class="desc">${t('users.createDesc')}</p>
    <div class="field"><label>${t('field.fullName')}</label><input id="u-name"></div>
    <div class="field"><label>${t('field.email')}</label><input id="u-email" type="email"></div>
    <div class="form-row">
      <div class="field"><label>${t('field.role')}</label><select id="u-role">${ROLES.map((r) => `<option value="${r}" ${r === 'comercial' ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('field.lang')}</label><select id="u-lang">${langOptions('en')}</select></div>
    </div>
    <p class="field-help" style="margin:-6px 0 4px">${t('users.langHelp')}</p>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" id="u-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary btn-sm" id="u-ok">${t('common.create')}</button>
    </div>`);
  $('#u-cancel').addEventListener('click', closeModal);
  $('#u-ok').addEventListener('click', async () => {
    const body = { name: $('#u-name').value.trim(), email: $('#u-email').value.trim(), role: $('#u-role').value, lang: $('#u-lang').value };
    if (!body.name || !body.email) { toast(t('users.needNameEmail'), 'err'); return; }
    try { await api('POST', '/api/users', body); closeModal(); viewUsers(); toast(t('users.created')); }
    catch (e) { if (e.message !== 'unauth') toast(e.code === 'email_taken' || /exist/i.test(e.message) ? t('users.emailExists') : t('common.errCreate'), 'err'); }
  });
}

function openEditUser(u) {
  if (!u) return;
  modal(`
    <h2>${t('users.editT')}</h2>
    <p class="desc">${t('users.editDesc')}</p>
    <div class="field"><label>${t('field.fullName')}</label><input id="u-name" value="${esc(u.name)}"></div>
    <div class="field"><label>${t('field.email')}</label><input id="u-email" type="email" value="${esc(u.email)}"></div>
    <div class="form-row">
      <div class="field"><label>${t('field.role')}</label><select id="u-role">${ROLES.map((r) => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${roleLabel(r)}</option>`).join('')}</select></div>
      <div class="field"><label>${t('field.lang')}</label><select id="u-lang">${langOptions(LANGS.includes(u.lang) ? u.lang : 'en')}</select></div>
    </div>
    <p class="field-help" style="margin:-6px 0 14px">${t('users.langHelp')}</p>
    <div class="field"><label>${t('field.status')}</label><select id="u-active">
      <option value="1" ${u.active ? 'selected' : ''}>${t('common.active')}</option>
      <option value="0" ${!u.active ? 'selected' : ''}>${t('common.inactive')}</option>
    </select></div>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" id="u-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary btn-sm" id="u-ok">${t('common.saveChanges')}</button>
    </div>`);
  $('#u-cancel').addEventListener('click', closeModal);
  $('#u-ok').addEventListener('click', async () => {
    const body = { name: $('#u-name').value.trim(), email: $('#u-email').value.trim(), role: $('#u-role').value, active: Number($('#u-active').value), lang: $('#u-lang').value };
    if (!body.name || !body.email) { toast(t('users.needNameEmail'), 'err'); return; }
    try {
      await api('PATCH', `/api/users/${u.id}`, body); closeModal();
      // Si el administrador cambió su propio idioma, el panel cambia ya (el servidor ya lo guardó)
      if (state.me && u.id === state.me.id && !state.me.impersonating && body.lang !== LANG) { state.me.lang = body.lang; setLang(body.lang); }
      else viewUsers();
      toast(t('users.updated'));
    }
    catch (e) { if (e.message !== 'unauth') toast(e.code === 'email_taken' || /exist/i.test(e.message) ? t('users.emailExists') : t('common.errSave'), 'err'); }
  });
}

// ============================================================
//  REDIRECCIONES 301/302 (solo admin)
// ============================================================
async function viewRedirects() {
  const v = $('#view');
  let rows = [];
  try { rows = (await api('GET', '/api/redirects')) || []; }
  catch (e) { if (e.message !== 'unauth') v.innerHTML = `<div class="empty"><div class="big">${t('common.restricted')}</div>${t('rd.restricted')}</div>`; return; }
  v.innerHTML = `
    <div class="topbar">
      <div><span class="ey">${t('rd.ey')}</span><h1>${t('rd.h1')}</h1></div>
      <div class="tools"><button class="btn btn-primary btn-sm" id="new-rd">${t('rd.new')}</button></div>
    </div>
    <p class="help" style="margin:-10px 0 16px;max-width:76ch">${t('rd.help')}</p>
    <div class="panel"><div id="rd-table"></div></div>`;
  $('#new-rd').addEventListener('click', openNewRedirect);
  paintRedirects(rows);
}

function paintRedirects(rows) {
  const wrap = $('#rd-table'); if (!wrap) return;
  if (!rows.length) { wrap.innerHTML = `<div class="empty"><div class="big">${t('rd.emptyBig')}</div>${t('rd.empty')}</div>`; return; }
  wrap.innerHTML = `<table><thead><tr>
    <th>${t('rd.th.from')}</th><th>${t('rd.th.to')}</th><th>${t('rd.th.type')}</th><th>${t('rd.th.status')}</th><th>${t('rd.th.hits')}</th><th></th>
    </tr></thead><tbody>
    ${rows.map((r) => `<tr>
      <td><code class="rd-path">${esc(r.from_path)}</code></td>
      <td><span class="rd-arrow">→</span> <code class="rd-path">${esc(r.to_path)}</code></td>
      <td><span class="status-pill ${r.code === 301 ? 'st-ganado' : 'st-contactado'}">${Number(r.code)}</span></td>
      <td>${r.active ? `<span style="color:var(--green-text);font-weight:700">● ${t('common.activeF')}</span>` : `<span style="color:var(--mute)">○ ${t('common.inactiveF')}</span>`}</td>
      <td><span class="mono" style="color:var(--dim)">${Number(r.hits) || 0}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-ghost btn-sm" data-rd-edit="${r.id}">${t('common.edit')}</button>
        <button class="btn btn-ghost btn-sm danger" data-rd-del="${r.id}">${t('common.delete')}</button>
      </td>
    </tr>`).join('')}
  </tbody></table>`;
  wrap.querySelectorAll('tbody tr').forEach((tr) => (tr.style.cursor = 'default'));
  wrap.querySelectorAll('[data-rd-edit]').forEach((b) => b.addEventListener('click', () => openEditRedirect(rows.find((x) => x.id === Number(b.dataset.rdEdit)))));
  wrap.querySelectorAll('[data-rd-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(t('rd.confirmDelete'))) return;
    try { await api('DELETE', `/api/redirects/${Number(b.dataset.rdDel)}`); viewRedirects(); toast(t('rd.deleted')); }
    catch (e) { if (e.message !== 'unauth') toast(t('common.errDelete'), 'err'); }
  }));
}

function redirectForm(r) {
  const isEdit = !!r;
  return `
    <h2>${isEdit ? t('rd.editT') : t('rd.createT')}</h2>
    <p class="desc">${t('rd.desc')}</p>
    <div class="field"><label>${t('rd.fromLabel')}</label><input id="rd-from" placeholder="${esc(t('rd.fromPh'))}" value="${esc(r ? r.from_path : '')}"></div>
    <div class="field"><label>${t('rd.toLabel')}</label><input id="rd-to" placeholder="${esc(t('rd.toPh'))}" value="${esc(r ? r.to_path : '')}"></div>
    <div class="field"><label>${t('rd.typeLabel')}</label><select id="rd-code">
      <option value="301" ${!r || r.code === 301 ? 'selected' : ''}>${t('rd.301')}</option>
      <option value="302" ${r && r.code === 302 ? 'selected' : ''}>${t('rd.302')}</option>
    </select></div>
    ${isEdit ? `<div class="field"><label>${t('field.status')}</label><select id="rd-active">
      <option value="1" ${r.active ? 'selected' : ''}>${t('common.activeF')}</option>
      <option value="0" ${!r.active ? 'selected' : ''}>${t('common.inactiveF')}</option>
    </select></div>` : ''}
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" id="rd-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary btn-sm" id="rd-ok">${isEdit ? t('common.save') : t('common.create')}</button>
    </div>`;
}

// El servidor responde en el idioma del panel (X-Wy-Lang); se reconoce el caso en es o en y se muestra el texto del panel.
function redirErr(e) {
  const m = String((e && e.message) || ''), c = (e && e.code) || '';
  if (c === 'redirect_exists' || /ya existe|exist/i.test(m)) return t('rd.errExists');
  if (c === 'redirect_same' || /iguales|same/i.test(m)) return t('rd.errSame');
  if (c === 'redirect_from_forbidden' || c === 'redirect_from_invalid' || /no permitido|not allowed/i.test(m)) return t('rd.errNotAllowed');
  return t('rd.errSave');
}

function openNewRedirect() {
  modal(redirectForm(null));
  $('#rd-cancel').addEventListener('click', closeModal);
  $('#rd-ok').addEventListener('click', async () => {
    const body = { from_path: $('#rd-from').value.trim(), to_path: $('#rd-to').value.trim(), code: Number($('#rd-code').value) };
    if (!body.from_path || !body.to_path) { toast(t('rd.needBoth'), 'err'); return; }
    try { await api('POST', '/api/redirects', body); closeModal(); viewRedirects(); toast(t('rd.created')); }
    catch (e) { if (e.message !== 'unauth') toast(redirErr(e), 'err'); }
  });
}

function openEditRedirect(r) {
  if (!r) return;
  modal(redirectForm(r));
  $('#rd-cancel').addEventListener('click', closeModal);
  $('#rd-ok').addEventListener('click', async () => {
    const body = { from_path: $('#rd-from').value.trim(), to_path: $('#rd-to').value.trim(), code: Number($('#rd-code').value), active: Number($('#rd-active').value) };
    if (!body.from_path || !body.to_path) { toast(t('rd.needBoth'), 'err'); return; }
    try { await api('PATCH', `/api/redirects/${r.id}`, body); closeModal(); viewRedirects(); toast(t('rd.updated')); }
    catch (e) { if (e.message !== 'unauth') toast(redirErr(e), 'err'); }
  });
}

// ============================================================
//  INTEGRACIONES (solo admin) — etiquetas + código de terceros del sitio público
// ============================================================
// [clave, nombre, placeholder, icono, color] — la ayuda de cada proveedor es t('pv.<clave>.help')
const PROVIDERS = [
  ['ga4_id', 'Google Analytics 4', 'G-XXXXXXXXXX', 'GA', '#E37400'],
  ['gtm_id', 'Google Tag Manager', 'GTM-XXXXXXX', 'TM', '#4285F4'],
  ['google_ads', 'Google Ads', 'AW-XXXXXXXXX', 'AD', '#34A853'],
  ['meta_pixel_id', 'Meta Pixel', '1234567890123456', 'f', '#1877F2'],
  ['tiktok_pixel_id', 'TikTok Pixel', 'CXXXXXXXXXXXXXXXXX', 'TT', '#111111'],
  ['clarity_id', 'Microsoft Clarity', 'abcdefghij', 'C', '#0078D4'],
  ['hotjar_id', 'Hotjar', '1234567', 'H', '#FD3A5C'],
];
// Cajas de código incrustado — etiqueta, ayuda y placeholder: t('code.<clave>.label|help|ph')
const CODE_FIELDS = [['custom_head'], ['custom_body_start'], ['custom_body_end']];
const SETTING_IDS = ['ga4_id', 'gtm_id', 'google_ads_id', 'google_ads_label', 'meta_pixel_id', 'tiktok_pixel_id', 'clarity_id', 'hotjar_id', 'notify_emails', 'whatsapp_number'];
const newId = () => Math.random().toString(36).slice(2, 8);
function parseSnippets(raw) {
  let arr = raw;
  if (typeof raw === 'string') { try { arr = JSON.parse(raw || '[]'); } catch (e) { arr = []; } }
  if (!Array.isArray(arr)) return [];
  return arr.filter((s) => s && typeof s === 'object').map((s) => ({
    id: String(s.id || newId()), name: String(s.name || ''), position: SNIPPET_POSITIONS[s.position] ? s.position : 'body_end',
    enabled: s.enabled === 0 || s.enabled === '0' || s.enabled === false ? 0 : 1, code: String(s.code || ''),
  }));
}
const excerpt = (code) => String(code || '').replace(/\s+/g, ' ').trim().slice(0, 90) || t('int.noCode');
// Estado del anti-spam a partir de /api/settings (recaptcha_secret_configured y la clave efectiva son de solo lectura)
function recaptchaStatus(s) {
  const hasKey = !!(s.recaptcha_site_key_effective || s.recaptcha_site_key);
  const secret = !!s.recaptcha_secret_configured;
  if (hasKey && secret) return { cls: 'ok', text: t('rcst.ok') };
  if (hasKey) return { cls: 'warn', text: t('rcst.noSecret') };
  if (secret) return { cls: 'warn', text: t('rcst.noKeyPaused') };
  return { cls: 'off', text: t('rcst.off') };
}
const clampScore = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? (Math.round(Math.min(0.9, Math.max(0.1, n)) * 10) / 10).toFixed(1) : '0.5'; };

async function viewIntegrations() {
  const v = $('#view');
  v.innerHTML = `<div class="empty">${t('common.loading')}</div>`;
  let s;
  try { s = await api('GET', '/api/settings'); }
  catch (e) { if (e.message !== 'unauth') v.innerHTML = `<div class="empty"><div class="big">${t('common.restricted')}</div>${t('int.restricted')}</div>`; return; }
  s = s || {};
  state.settings = s;
  const snippets = parseSnippets(s.snippets);
  const on = s.tracking_enabled === '1' || s.tracking_enabled === 1;
  const endpoint = `${location.origin}/api/public/site-config`;
  const val = (k) => esc(s[k] || '');
  const rcFromEnv = s.recaptcha_key_source === 'env';
  const rcSt = recaptchaStatus(s);

  const providerCard = ([key, name, ph, ic, color]) => {
    const filled = key === 'google_ads' ? !!s.google_ads_id : !!s[key];
    const fields = key === 'google_ads'
      ? `<div class="field"><label>${t('int.convId')}</label><input id="set-google_ads_id" value="${val('google_ads_id')}" placeholder="AW-XXXXXXXXX" autocomplete="off" spellcheck="false"></div>
         <div class="field"><label>${t('int.convLabel')}</label><input id="set-google_ads_label" value="${val('google_ads_label')}" placeholder="AbCdEfGhIjKlMnOp" autocomplete="off" spellcheck="false"></div>`
      : `<div class="field"><label>${t('int.id')}</label><input id="set-${key}" value="${val(key)}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></div>`;
    return `<div class="provider ${filled ? 'filled' : ''}" data-pv="${key}">
      <div class="pv-head"><span class="pv-ic" style="background:${color}">${ic}</span><b>${name}</b><span class="pv-on" title="${esc(filled ? t('int.configured') : t('int.notConfigured'))}"></span></div>
      ${fields}
      <div class="field-help">${t(`pv.${key}.help`)}</div>
    </div>`;
  };

  v.innerHTML = `
    <div class="topbar">
      <div><span class="ey">${t('int.ey')}</span><h1>${t('int.h1')}</h1></div>
      <div class="tools"><button class="btn btn-primary btn-sm" id="int-save">${t('common.save')}</button></div>
    </div>
    <div class="detail-grid">
      <div class="detail-main">
        <div class="card-box">
          <div class="set-toggle">
            <div><div class="lab">${t('int.masterLab')}</div><div class="help">${t('int.masterHelp')}</div></div>
            <label class="switch"><input type="checkbox" id="set-tracking_enabled" ${on ? 'checked' : ''}><span></span></label>
          </div>
          <div class="section-t">${t('int.providers')}</div>
          <div class="providers">${PROVIDERS.map(providerCard).join('')}</div>
        </div>

        <div class="card-box">
          <div class="section-t">${t('int.antispamT')}</div>
          <div class="provider rc-card ${rcSt.cls === 'ok' ? 'filled' : ''}" data-pv="recaptcha">
            <div class="pv-head"><span class="pv-ic" style="background:#1A73E8">rC</span><b>reCAPTCHA v3 · anti-spam</b><span class="pv-on" title="${esc(rcSt.cls === 'ok' ? t('int.rcActive') : t('int.rcInactive'))}"></span></div>
            <div class="rc-status ${rcSt.cls}" id="rc-status"><i></i><span>${rcSt.text}</span></div>
            <p class="help" style="margin:0 0 12px">${t('int.rcHelp')}</p>
            <div class="form-row">
              <div class="field"><label>${t('int.siteKey')}</label>
                <input id="set-recaptcha_site_key" value="${esc(rcFromEnv ? (s.recaptcha_site_key_effective || '') : (s.recaptcha_site_key || ''))}" placeholder="6Lc…" autocomplete="off" spellcheck="false"${rcFromEnv ? ' disabled' : ''}>
                <div class="field-help">${rcFromEnv ? t('int.siteKeyEnv') : t('int.siteKeyHelp')}</div>
              </div>
              <div class="field"><label>${t('int.minScore')}</label>
                <input id="set-recaptcha_min_score" type="number" min="0.1" max="0.9" step="0.1" inputmode="decimal" value="${esc(clampScore(s.recaptcha_min_score))}">
                <div class="field-help">${t('int.minScoreHelp')}</div>
              </div>
            </div>
            <div class="rc-keys">
              <b>${t('int.keysT')}</b>
              <p>${t('int.keysBody', { link: '<a href="https://www.google.com/recaptcha/admin" target="_blank" rel="noopener noreferrer">google.com/recaptcha/admin</a>' })}</p>
            </div>
          </div>
        </div>

        <div class="card-box">
          <div class="section-t">${t('int.codeT')}</div>
          <p class="help" style="margin:-4px 0 16px">${t('int.codeHelp')}</p>
          ${CODE_FIELDS.map(([k]) => `
            <div class="code-block">
              <div class="field"><label>${esc(t(`code.${k}.label`))}</label><textarea id="set-${k}" class="code" rows="5" spellcheck="false" placeholder="${esc(t(`code.${k}.ph`))}">${val(k)}</textarea></div>
              <div class="field-help">${esc(t(`code.${k}.help`))}</div>
            </div>`).join('')}
        </div>

        <div class="card-box">
          <div class="section-t">${t('int.snippetsT')} <button class="btn btn-ghost btn-sm right" id="sn-add">${t('int.snippetAdd')}</button></div>
          <p class="help" style="margin:-4px 0 14px">${t('int.snippetsHelp')}</p>
          <div id="sn-list"></div>
        </div>

        <div class="card-box">
          <div class="section-t">${t('int.notifT')}</div>
          <div class="form-row">
            <div class="field"><label>${t('int.notifyEmails')}</label><input id="set-notify_emails" value="${val('notify_emails')}" placeholder="${esc(t('int.notifyEmailsPh'))}" autocomplete="off"><div class="field-help">${t('int.notifyEmailsHelp')}</div></div>
            <div class="field"><label>${t('int.wa')}</label><input id="set-whatsapp_number" value="${esc(s.whatsapp_number || DEFAULT_WA)}" placeholder="${DEFAULT_WA}" inputmode="numeric" autocomplete="off"><div class="field-help">${t('int.waHelp')}</div></div>
          </div>
        </div>

        <div class="save-bar"><button class="btn btn-primary" id="int-save-2">${t('common.saveChanges')}</button><span class="help">${t('int.saveHelp')}</span></div>
      </div>

      <aside class="detail-side">
        <div class="card-box">
          <div class="section-t">${t('int.howT')}</div>
          <ol class="how">
            <li>${t('int.how1')}</li>
            <li>${t('int.how2')}</li>
            <li>${t('int.how3')}</li>
          </ol>
          <div class="endpoint"><label>${t('int.endpoint')}</label><code>${esc(endpoint)}</code></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
            <a class="btn btn-ghost btn-sm" href="${esc(endpoint)}" target="_blank" rel="noopener noreferrer">${t('int.viewJson')}</a>
            <button class="btn btn-ghost btn-sm" id="int-copy">${t('int.copyUrl')}</button>
          </div>
        </div>
        <div class="card-box">
          <div class="section-t">${t('int.convT')}</div>
          <p class="help" style="margin:0 0 10px">${t('int.convIntro')}</p>
          <ul class="ev-list">
            <li><code>dataLayer wyelee_lead</code> GTM (variable <code>lead_source</code>)</li>
            <li><code>gtag generate_lead</code> GA4</li>
            <li><code>gtag conversion</code> ${t('int.convAds')}</li>
            <li><code>fbq Lead</code> Meta Pixel</li>
            <li><code>ttq SubmitForm</code> TikTok Pixel</li>
          </ul>
          <p class="help" style="margin-top:12px">${t('int.convGtm')}</p>
        </div>
      </aside>
    </div>`;

  // ----- fragmentos de terceros (lista local; se persiste con Guardar) -----
  function paintSnippets() {
    const host = $('#sn-list'); if (!host) return;
    if (!snippets.length) { host.innerHTML = `<p class="muted">${t('sn.none')}</p>`; return; }
    host.innerHTML = snippets.map((sn, i) => `
      <div class="snippet-row ${sn.enabled ? '' : 'off'}" data-i="${i}">
        <label class="switch" title="${esc(sn.enabled ? t('sn.liveTitle') : t('sn.offTitle'))}"><input type="checkbox" data-k="enabled" ${sn.enabled ? 'checked' : ''}><span></span></label>
        <div class="sn-main"><b>${esc(sn.name || t('sn.noName'))}</b><code>${esc(excerpt(sn.code))}</code></div>
        <select class="sn-pos" data-k="position" title="${esc(t('sn.position'))}">${Object.keys(SNIPPET_POSITIONS).map((k) => `<option value="${k}" ${sn.position === k ? 'selected' : ''}>${esc(snipPosLabel(k))}</option>`).join('')}</select>
        <div class="sn-act"><button class="btn btn-ghost btn-sm" data-act="edit">${t('common.edit')}</button><button class="btn btn-ghost btn-sm danger" data-act="del">${t('common.delete')}</button></div>
      </div>`).join('');
  }
  paintSnippets();
  $('#sn-list').addEventListener('change', (e) => {
    const row = e.target.closest('.snippet-row'); const k = e.target.dataset.k; if (!row || !k) return;
    const sn = snippets[Number(row.dataset.i)]; if (!sn) return;
    if (k === 'enabled') sn.enabled = e.target.checked ? 1 : 0;
    if (k === 'position') sn.position = e.target.value;
    paintSnippets();
  });
  $('#sn-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const i = Number(b.closest('.snippet-row').dataset.i); const sn = snippets[i]; if (!sn) return;
    if (b.dataset.act === 'del') { if (!confirm(t('sn.confirmDelete', { name: sn.name || t('sn.noNameLower') }))) return; snippets.splice(i, 1); paintSnippets(); }
    else openSnippetModal(sn, (upd) => { Object.assign(sn, upd); paintSnippets(); });
  });
  $('#sn-add').addEventListener('click', () => openSnippetModal(null, (sn) => { snippets.push(Object.assign({ id: newId() }, sn)); paintSnippets(); }));

  // ----- guardar -----
  const save = async () => {
    const g = (k) => { const el = $('#set-' + k); return el ? el.value.trim() : ''; };
    const body = { tracking_enabled: $('#set-tracking_enabled').checked ? '1' : '0' };
    SETTING_IDS.forEach((k) => { body[k] = g(k); });
    CODE_FIELDS.forEach(([k]) => { body[k] = $('#set-' + k).value; });
    body.whatsapp_number = body.whatsapp_number.replace(/\D/g, '') || DEFAULT_WA;
    body.snippets = JSON.stringify(snippets.map((sn) => ({ id: sn.id, name: sn.name, position: sn.position, enabled: sn.enabled ? 1 : 0, code: sn.code })));
    // reCAPTCHA: la clave solo se envía si no viene de la variable de entorno (campo deshabilitado)
    const rcKey = $('#set-recaptcha_site_key');
    if (rcKey && !rcKey.disabled) body.recaptcha_site_key = rcKey.value.trim();
    body.recaptcha_min_score = clampScore($('#set-recaptcha_min_score').value);
    const btns = [$('#int-save'), $('#int-save-2')]; btns.forEach((b) => (b.disabled = true));
    try {
      const saved = await api('PUT', '/api/settings', body);
      state.settings = saved && typeof saved === 'object' ? saved : Object.assign({}, state.settings, body);
      toast(t('int.saved'));
      v.querySelectorAll('.provider:not(.rc-card)').forEach((p) => { const k = p.dataset.pv === 'google_ads' ? 'google_ads_id' : p.dataset.pv; p.classList.toggle('filled', !!body[k]); });
      paintRecaptchaCard(state.settings);
    }
    catch (e) { if (e.message !== 'unauth') toast(e.code === 'admin_only' || e.message === 'admin only' ? t('int.adminOnly') : e.code === 'recaptcha_secret_in_site_key' || /RECAPTCHA_SECRET/.test(e.message) ? e.message : t('common.errSave'), 'err'); }
    btns.forEach((b) => (b.disabled = false));
  };
  // Repinta el estado del anti-spam con lo que devolvió el servidor (umbral normalizado, clave efectiva)
  function paintRecaptchaCard(st) {
    const card = v.querySelector('.rc-card'); if (!card || !st) return;
    const rs = recaptchaStatus(st);
    card.classList.toggle('filled', rs.cls === 'ok');
    const box = $('#rc-status'); if (box) { box.className = `rc-status ${rs.cls}`; box.innerHTML = `<i></i><span>${rs.text}</span>`; }
    const ms = $('#set-recaptcha_min_score'); if (ms) ms.value = clampScore(st.recaptcha_min_score);
    const key = $('#set-recaptcha_site_key'); if (key && !key.disabled) key.value = st.recaptcha_site_key || '';
  }
  $('#int-save').addEventListener('click', save);
  $('#int-save-2').addEventListener('click', save);
  $('#int-copy').addEventListener('click', () => navigator.clipboard.writeText(endpoint).then(() => toast(t('int.urlCopied'))).catch(() => toast(t('common.errCopy'), 'err')));
}

function openSnippetModal(sn, onSave) {
  const isEdit = !!sn;
  const d = sn || { name: '', position: 'body_end', enabled: 1, code: '' };
  modal(`
    <h2>${isEdit ? t('sn.editT') : t('sn.newT')}</h2>
    <p class="desc">${t('sn.desc')}</p>
    <div class="form-row">
      <div class="field"><label>${t('field.name')}</label><input id="sn-name" value="${esc(d.name)}" placeholder="${esc(t('sn.namePh'))}"></div>
      <div class="field"><label>${t('sn.position')}</label><select id="sn-pos">${Object.keys(SNIPPET_POSITIONS).map((k) => `<option value="${k}" ${d.position === k ? 'selected' : ''}>${esc(snipPosLabel(k))}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>${t('sn.code')}</label><textarea id="sn-code" class="code" rows="9" spellcheck="false" placeholder="${esc('<script src="https://embed.tawk.to/XXXX/default" async></script>')}">${esc(d.code)}</textarea></div>
    <label class="check-inline"><input type="checkbox" id="sn-on" ${d.enabled ? 'checked' : ''}> ${t('sn.liveTitle')}</label>
    <div class="modal-foot">
      <button class="btn btn-ghost btn-sm" id="sn-cancel">${t('common.cancel')}</button>
      <button class="btn btn-primary btn-sm" id="sn-ok">${isEdit ? t('sn.apply') : t('sn.add')}</button>
    </div>`, 'wide');
  $('#sn-cancel').addEventListener('click', closeModal);
  $('#sn-ok').addEventListener('click', () => {
    const upd = { name: $('#sn-name').value.trim(), position: $('#sn-pos').value, enabled: $('#sn-on').checked ? 1 : 0, code: $('#sn-code').value };
    if (!upd.name) { toast(t('sn.needName'), 'err'); return; }
    if (!upd.code.trim()) { toast(t('sn.needCode'), 'err'); return; }
    closeModal(); onSave(upd);
    toast(t('sn.remember'));
  });
}

// ============================================================
//  ESTADÍSTICAS
// ============================================================
async function viewStats(month) {
  const v = $('#view');
  v.innerHTML = `<div class="empty">${t('common.loading')}</div>`;
  let s;
  try { s = await api('GET', '/api/stats' + (month ? `?month=${encodeURIComponent(month)}` : '')); }
  catch (e) { if (e.message !== 'unauth') v.innerHTML = `<div class="empty">${t('stats.errLoad')}</div>`; return; }
  const monthly = s.monthly || [], loss = s.lossBreakdown || [], byService = s.byService || [], byCity = s.byCity || [], funnel = s.funnel || {}, k = s.kpi || {};
  const maxBar = Math.max(1, ...monthly.flatMap((m) => [m.created, m.won, m.lost]));
  const maxLoss = Math.max(1, ...loss.map((l) => l.count));
  const maxSvc = Math.max(1, ...byService.map((x) => x.count));
  const maxCity = Math.max(1, ...byCity.map((x) => x.count));
  const funnelMax = Math.max(1, ...STATUSES.map((st) => Number(funnel[st]) || 0));
  const scoped = !!s.month;
  const monthOpts = [`<option value="">${t('stats.allMonths')}</option>`,
    ...(s.availableMonths || []).slice().reverse().map((m) => `<option value="${esc(m)}" ${m === s.month ? 'selected' : ''}>${fmtMonthLong(m)}</option>`)].join('');
  const num = (x) => (x === null || x === undefined || x === '' ? '—' : x);
  const kpis = [
    ['', scoped ? t('stats.kMonth') : t('stats.kTotal'), num(k.total)],
    scoped ? ['red', t('stats.kLost'), num(k.lost)] : ['blue', t('stats.kNew'), num(k.newThisMonth)],
    ['green', t('stats.kWon'), num(k.won)],
    ['green', t('stats.kWinRate'), num(k.winRate), '%'],
    ['violet', t('stats.kAvgQuote'), num(k.avgHoursToQuote), 'h'],
    ['teal', t('stats.kSla'), num(k.slaRate), '%'],
    ['red', t('stats.kOverdue'), num(k.overdue)],
  ];
  // Etiquetas por clave en el idioma del panel (el servidor manda las suyas en español)
  const svcRowLabel = (x) => (x.key === 'contact' ? t('stats.contactNoService') : (svcLabel(x.key) || x.label || x.key || t('stats.noService')));

  v.innerHTML = `
    <div class="topbar">
      <div><span class="ey">${t('stats.ey')}</span><h1>${t('stats.h1')}</h1></div>
      <div class="tools"><label class="month-lab" for="stat-month">${t('stats.filterMonth')}</label><select id="stat-month" class="month-sel">${monthOpts}</select></div>
    </div>

    <div class="kpis">
      ${kpis.map(([cls, lab, val, suf]) => `<div class="kpi ${cls}"><div class="lab">${lab}</div><div class="val">${esc(val)}${suf && val !== '—' ? `<small>${suf}</small>` : ''}</div></div>`).join('')}
    </div>

    <div class="stat-grid">
      <div class="card-box">
        <h3>${t('stats.monthlyT')}</h3>
        <p class="desc">${t('stats.monthlyDesc', { n: monthly.length || 6 })}</p>
        ${monthly.length ? `<div class="chart">
          ${monthly.map((m) => `
            <div class="bar-group">
              <div class="bars">
                <div class="bar created" style="height:${(m.created / maxBar) * 100}%" data-v="${Number(m.created) || 0}"></div>
                <div class="bar won" style="height:${(m.won / maxBar) * 100}%" data-v="${Number(m.won) || 0}"></div>
                <div class="bar lost" style="height:${(m.lost / maxBar) * 100}%" data-v="${Number(m.lost) || 0}"></div>
              </div>
              <span class="bar-x">${esc(fmtMonth(m.month))}</span>
            </div>`).join('')}
        </div>
        <div class="legend">
          <span><i style="background:var(--blue)"></i>${t('stats.created')}</span>
          <span><i style="background:var(--green)"></i>${t('stats.won')}</span>
          <span><i style="background:var(--red)"></i>${t('stats.lost')}</span>
        </div>` : `<p class="muted">${t('stats.noMonthly')}</p>`}
      </div>

      <div class="card-box">
        <h3>${t('stats.convT')}</h3>
        <p class="desc">${t('stats.convDesc')}</p>
        ${monthly.length ? monthly.map((m) => `
          <div class="conv-row">
            <span class="m">${esc(fmtMonth(m.month))}</span>
            <div class="conv-track"><div class="conv-fill" style="width:${Math.min(100, Number(m.conversion) || 0)}%"></div></div>
            <span class="pct">${Number(m.conversion) || 0}%</span>
          </div>`).join('') : `<p class="muted">${t('common.noData')}</p>`}
      </div>

      <div class="card-box">
        <h3>${scoped ? t('stats.funnelMonth') : t('stats.funnelNow')}</h3>
        <p class="desc">${scoped ? t('stats.funnelMonthDesc', { m: fmtMonthLong(s.month) }) : t('stats.funnelNowDesc')}</p>
        <div class="funnel">
          ${STATUSES.map((st) => `
            <div class="fn-row">
              <span class="lab"><span class="col-dot" style="background:${STATUS_META[st].color}"></span>${STATUS_META[st].label}</span>
              <div class="fn-bar" style="width:${Math.max(8, ((Number(funnel[st]) || 0) / funnelMax) * 100)}%;background:${STATUS_META[st].color}">${Number(funnel[st]) || 0}</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="card-box">
        <h3>${t('stats.bySvcT')}</h3>
        <p class="desc">${t('stats.bySvcDesc')}</p>
        ${byService.length ? byService.map((x) => `
          <div class="dist-row">
            <span class="lab" title="${esc(svcRowLabel(x))}">${esc(svcRowLabel(x))}</span>
            <div class="dist-track"><div class="dist-fill" style="width:${(x.count / maxSvc) * 100}%"></div></div>
            <span class="n">${Number(x.count) || 0}</span>
          </div>`).join('') : `<p class="muted">${t('common.noData')}</p>`}
      </div>

      <div class="card-box">
        <h3>${t('stats.byCityT')}</h3>
        <p class="desc">${t('stats.byCityDesc')}</p>
        ${byCity.length ? byCity.map((x) => `
          <div class="dist-row">
            <span class="lab" title="${esc(x.city || '')}">${esc(x.city || t('stats.noCity'))}</span>
            <div class="dist-track"><div class="dist-fill navy" style="width:${(x.count / maxCity) * 100}%"></div></div>
            <span class="n">${Number(x.count) || 0}</span>
          </div>`).join('') : `<p class="muted">${t('common.noData')}</p>`}
      </div>

      <div class="card-box">
        <h3>${t('stats.lossT')}</h3>
        <p class="desc">${t('stats.lossDesc')}</p>
        ${loss.length ? loss.map((l) => `
          <div class="loss-row">
            <span class="lab">${esc(lossLabel(l.key || l.reason) || l.label)}</span>
            <div class="loss-track"><div class="loss-fill" style="width:${(l.count / maxLoss) * 100}%"></div></div>
            <span class="n">${Number(l.count) || 0}</span>
          </div>`).join('') : `<p class="muted">${t('stats.noLost')}</p>`}
      </div>
    </div>`;

  $('#stat-month').addEventListener('change', (e) => viewStats(e.target.value || undefined));
}

// ---------- data loaders ----------
// /api/leads → { leads, spamCount } (los retenidos como spam no vienen: Kanban, tabla y badge los ignoran).
// Acepta también el formato antiguo (array) por si la API y el panel se despliegan desfasados.
async function loadLeads() {
  const r = await api('GET', '/api/leads');
  state.leads = Array.isArray(r) ? r : ((r && r.leads) || []);
  if (r && !Array.isArray(r)) state.spamCount = Number(r.spamCount) || 0;
  const b = $('#badge-leads'); if (b) b.textContent = state.leads.length || '';
  const sn = $('#spam-n'); if (sn) sn.textContent = `(${Number(state.spamCount) || 0})`;
}
async function loadSpamLeads() {
  const r = await api('GET', '/api/leads?spam=1');
  state.spamLeads = Array.isArray(r) ? r : ((r && r.leads) || []);
  state.spamCount = r && !Array.isArray(r) ? Number(r.spamCount) || 0 : state.spamLeads.length;
}

// ============================================================
//  BOOT
// ============================================================
(async function boot() {
  // Sin sesión: si el hash cambia (p. ej. llega #expired desde /crm/auth/verify) se repinta el login con el aviso
  window.addEventListener('hashchange', () => { if (!state.me) renderLogin(); });
  try { state.me = await api('GET', '/api/me'); }
  catch (e) { if (e.message !== 'unauth') renderLogin(); return; } // 401 ya pintó el login
  // Con sesión manda el idioma guardado en el usuario (users.lang). En «Entrar como», /api/me devuelve el idioma
  // de la persona real (el administrador), así que el panel no cambia de idioma al ayudar a otro usuario.
  if (state.me && LANGS.includes(state.me.lang) && state.me.lang !== LANG) {
    LANG = state.me.lang; storeLang(LANG); document.documentElement.lang = LANG;
  }
  try { state.meta = await api('GET', '/api/meta'); } catch (e) { state.meta = null; }
  // El comercial no puede listar usuarios: los selectores de responsable caen a "yo mismo"
  try { state.users = (await api('GET', '/api/users')) || []; } catch (e) { state.users = []; }
  if (isAdmin()) { try { state.settings = await api('GET', '/api/settings'); } catch (e) { state.settings = null; } }
  try { await loadLeads(); } catch (e) { if (e.message === 'unauth') return; state.leads = []; toast(t('boot.errLeads'), 'err'); }
  window.addEventListener('hashchange', syncHash);
  syncHash(); // fija la vista desde el hash (o kanban por defecto) y renderiza
  startPolling();
})();

// Hash routing: la vista actual vive en el hash (#stats, #users, #lead-<id>…) para
// que el reload conserve la página y el botón Atrás del navegador funcione.
function syncHash() {
  if (!state.me) return;
  const h = location.hash.replace(/^#/, '');
  const m = h.match(/^lead-(\d+)$/);
  if (m) { state.detailId = Number(m[1]); state.view = 'leadDetail'; }
  else if (VIEWS.includes(h)) { state.view = h; }
  else if (state.view === 'leadDetail') { state.view = 'leads'; }
  closeModal();
  renderApp();
}
