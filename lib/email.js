// ============================================================
//  Wyelee — correo transaccional vía Resend (REST, sin dependencias).
//   · sendMagicLink        → enlace de acceso al panel (un solo uso, 15 min)
//   · sendLeadNotification → aviso de nueva solicitud a los admins (fotos adjuntas)
//   · sendTaskReminder     → recordatorio de tarea (inmediato o programado con scheduled_at)
//   · cancelScheduledEmail → cancela un correo programado en Resend
//  Idioma: cada función recibe `lang` ('es' | 'en') = idioma del DESTINATARIO (lo decide lib/app.js, que agrupa
//  a los destinatarios por idioma y manda un correo por grupo). Los datos del cliente nunca se traducen.
//  Todo es best-effort: ninguna función lanza; devuelven { ok, ... }.
//  La API key se lee de process.env.RESEND_API_KEY (nunca hardcodeada).
// ============================================================
import process from 'node:process';

const API = 'https://api.resend.com/emails';
const NAVY = '#1D153E';
const GREEN = '#25803A';
const GREEN_TXT = '#23752E';
const GREY = '#4B4668';
const FOG = '#F2F4F1';

const ESC = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NL2BR = (s) => ESC(s).replace(/\r?\n/g, '<br>');

function fromAddress() { return process.env.MAIL_FROM || 'Wyelee <onboarding@resend.dev>'; }
function apiKey() { return process.env.RESEND_API_KEY || ''; }
const L = (lang) => (lang === 'en' ? 'en' : 'es');

// Fecha/hora en horario de Adelaide: es-CO en español, en-AU en inglés
export function adelaide(iso, lang = 'es') {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(L(lang) === 'en' ? 'en-AU' : 'es-CO', { timeZone: 'Australia/Adelaide', dateStyle: 'medium', timeStyle: 'short' }) + ' (Adelaide)';
  } catch (e) { return String(iso); }
}

// ---------------- Textos por idioma (español = los de siempre) ----------------
const T = {
  es: {
    footer: 'Wyelee Assembly · Adelaide, SA · Notificación automática del panel.',
    magic: {
      subject: 'Tu acceso al panel — Wyelee',
      kicker: 'Panel · Acceso',
      intro: (name) => `Hola${name ? ' ' + name : ''}, usa este botón para entrar al panel de Wyelee. El enlace es de un solo uso y caduca en 15&nbsp;minutos.`,
      button: 'Entrar al panel',
      ignore: 'Si no solicitaste este acceso, ignora este correo.',
      copy: 'O copia y pega:',
    },
    lead: {
      subject: (name, svc) => `Nueva solicitud de cotización — ${name} (${svc})`,
      kickerQuote: 'Nueva solicitud de cotización',
      kickerContact: 'Nuevo mensaje de contacto',
      introQuote: 'Llegó una nueva solicitud de cotización desde el sitio web. Estos son los datos:',
      introContact: 'Llegó un nuevo mensaje desde el formulario de contacto del sitio.',
      newContact: 'Nuevo contacto',
      svcContact: 'Contacto',
      svcQuote: 'Cotización',
      reply: (mail) => `Puedes responder este correo directamente: la respuesta le llega a ${mail}.`,
      button: 'Ver en el panel',
      photos: (n) => `${n} adjunta${n === 1 ? '' : 's'}`,
      channel: (c) => c,
      source: (s) => s,
      rows: { name: 'Nombre', contact: 'Contacto', location: 'Ubicación', service: 'Servicio', items: 'Artículos', condition: 'Condición', when: 'Días / franja', addons: 'Add-ons', notes: 'Notas', photos: 'Fotos', source: 'Fuente', channel: 'Canal', page: 'Página', date: 'Fecha' },
    },
    task: {
      subject: (title, leadName) => `⏰ Recordatorio: ${title} — ${leadName}`,
      kicker: 'Recordatorio de tarea',
      intro: '⏰ Te programaste un recordatorio para este lead. Ya es la hora:',
      button: 'Abrir la ficha',
      rows: { task: 'Tarea', due: 'Vence', lead: 'Lead', contact: 'Contacto', service: 'Servicio', location: 'Ubicación', status: 'Estado' },
    },
  },
  en: {
    footer: 'Wyelee Assembly · Adelaide, SA · Automated notification from the Wyelee panel.',
    magic: {
      subject: 'Your Wyelee panel sign-in link',
      kicker: 'Panel · Sign-in',
      intro: (name) => `Hi${name ? ' ' + name : ''}, use the button below to sign in to the Wyelee panel. The link can only be used once and expires in 15&nbsp;minutes.`,
      button: 'Sign in to the panel',
      ignore: "If you didn't request this, you can ignore this email.",
      copy: 'Or copy and paste:',
    },
    lead: {
      subject: (name, svc, isContact) => (isContact ? `New contact message — ${name}` : `New quote request — ${name} (${svc})`),
      kickerQuote: 'New quote request',
      kickerContact: 'New contact message',
      introQuote: 'A new quote request just came in from the website. Here are the details:',
      introContact: 'A new message just came in through the website contact form.',
      newContact: 'New contact',
      svcContact: 'Contact',
      svcQuote: 'Quote',
      reply: (mail) => `You can reply to this email directly: your reply goes to ${mail}.`,
      button: 'View in the panel',
      photos: (n) => `${n} attached`,
      channel: (c) => (c === 'directo' ? 'direct' : c),
      source: (s) => ({ quote: 'Quote form', contact: 'Contact form', manual: 'Manual' }[s] || s),
      rows: { name: 'Name', contact: 'Contact', location: 'Location', service: 'Service', items: 'Items', condition: 'Condition', when: 'Days / time', addons: 'Add-ons', notes: 'Notes', photos: 'Photos', source: 'Source', channel: 'Channel', page: 'Page', date: 'Date' },
    },
    task: {
      subject: (title, leadName) => `⏰ Reminder: ${title} — ${leadName}`,
      kicker: 'Task reminder',
      intro: '⏰ A reminder for this lead is now due:',
      button: 'Open lead',
      rows: { task: 'Task', due: 'Due', lead: 'Lead', contact: 'Contact', service: 'Service', location: 'Location', status: 'Status' },
    },
  },
};

// ---------------- Plantilla base (marca Wyelee: fondo blanco, cabecera navy, botón verde) ----------------
function layout({ kicker, bodyHtml, width = 560, lang = 'es' }) {
  const t = T[L(lang)];
  return `<!doctype html><html lang="${L(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:${FOG};padding:32px 12px;font-family:'Nunito Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${NAVY}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="max-width:${width}px;width:100%;background:#ffffff;border:1px solid #E3E6E1;border-radius:16px;overflow:hidden">
      <tr><td style="background:${NAVY};padding:22px 32px">
        <div style="font-family:Nunito,'Nunito Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1">wyelee<span style="color:#6FD17B">.</span></div>
        ${kicker ? `<div style="color:#C9C4E4;font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-top:8px">${ESC(kicker)}</div>` : ''}
      </td></tr>
      ${bodyHtml}
      <tr><td style="padding:14px 32px 22px;color:#8A86A3;font-size:12px;line-height:1.6;border-top:1px solid #EEF0EC">
        ${ESC(t.footer)}
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}
function button(href, label) {
  return `<a href="${ESC(href)}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:100px">${ESC(label)} →</a>`;
}
function dataTable(rows) {
  const tr = rows
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v, raw]) => `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #EEF0EC;color:${GREY};font-size:12px;letter-spacing:.02em;vertical-align:top;width:150px">${ESC(k)}</td>
      <td style="padding:9px 0;border-bottom:1px solid #EEF0EC;color:${NAVY};font-size:14px;line-height:1.5">${raw ? v : NL2BR(v)}</td>
    </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #EEF0EC">${tr}</table>`;
}
const linkTel = (m) => m ? `<a href="tel:${ESC(String(m).replace(/[^\d+]/g, ''))}" style="color:${GREEN_TXT};text-decoration:none;font-weight:700">${ESC(m)}</a>` : '';
const linkMail = (e) => e ? `<a href="mailto:${ESC(e)}" style="color:${GREEN_TXT};text-decoration:none;font-weight:700">${ESC(e)}</a>` : '';

// ---------------- Plantillas ----------------
function magicLinkHtml({ name, link, lang }) {
  const t = T[L(lang)].magic;
  const body = `
      <tr><td style="padding:24px 32px 4px;font-size:15px;line-height:1.6;color:${NAVY}">
        ${t.intro(name ? ESC(name) : '')}
      </td></tr>
      <tr><td style="padding:20px 32px 8px">${button(link, t.button)}</td></tr>
      <tr><td style="padding:8px 32px 22px;color:${GREY};font-size:12px;line-height:1.6">
        ${ESC(t.ignore)}<br>
        <span style="color:#8A86A3">${ESC(t.copy)}</span><br><span style="color:${GREY};word-break:break-all">${ESC(link)}</span>
      </td></tr>`;
  return layout({ kicker: t.kicker, bodyHtml: body, width: 480, lang });
}

function leadNotifyHtml({ lead, crmLink, photoCount, lang }) {
  const t = T[L(lang)].lead;
  const r = t.rows;
  const name = lead.name || t.newContact;
  const location = [lead.suburb, lead.postcode, lead.city].filter(Boolean).join(' · ');
  const when = [lead.days_label || lead.days, lead.time_label || lead.time].filter(Boolean).join(' / ');
  const contact = [linkTel(lead.mobile), linkMail(lead.email)].filter(Boolean).join(' &nbsp;·&nbsp; ');
  const created = lead.created_label || adelaide(lead.created_at, lang);
  const rows = [
    [r.name, name],
    [r.contact, contact, true],
    [r.location, location],
    [r.service, lead.service_label || lead.service],
    [r.items, lead.items],
    [r.condition, lead.condition_label || lead.condition],
    [r.when, when],
    [r.addons, lead.addons_label || lead.addons],
    [r.notes, lead.notes],
    [r.photos, photoCount ? t.photos(photoCount) : ''],
    [r.source, lead.source ? t.source(lead.source) : ''],
    [r.channel, lead.channel ? t.channel(lead.channel) : ''],
    [r.page, lead.page],
    [r.date, created],
  ];
  const isContact = lead.source === 'contact';
  const body = `
      <tr><td style="padding:24px 32px 4px;font-size:15px;line-height:1.6;color:${NAVY}">
        ${ESC(isContact ? t.introContact : t.introQuote)}
      </td></tr>
      <tr><td style="padding:14px 32px 6px">${dataTable(rows)}</td></tr>
      ${lead.email ? `<tr><td style="padding:8px 32px 2px;color:${GREY};font-size:12px">${t.reply(linkMail(lead.email))}</td></tr>` : ''}
      <tr><td style="padding:18px 32px 16px">${button(crmLink, t.button)}</td></tr>`;
  return layout({ kicker: isContact ? t.kickerContact : t.kickerQuote, bodyHtml: body, lang });
}

function taskReminderHtml({ task, lead, crmLink, lang }) {
  const t = T[L(lang)].task;
  const r = t.rows;
  const leadName = (lead && lead.name) || 'Lead';
  const contact = lead ? [linkTel(lead.mobile), linkMail(lead.email)].filter(Boolean).join(' &nbsp;·&nbsp; ') : '';
  const rows = [
    [r.task, task.title],
    [r.due, adelaide(task.due_at, lang)],
    [r.lead, leadName],
    [r.contact, contact, true],
    [r.service, lead && (lead.service_label || lead.service)],
    [r.location, lead ? [lead.suburb, lead.postcode].filter(Boolean).join(' ') : ''],
    [r.status, lead && (lead.status_label || lead.status)],
  ];
  const body = `
      <tr><td style="padding:24px 32px 4px;font-size:15px;line-height:1.6;color:${NAVY}">
        ${ESC(t.intro)}
      </td></tr>
      <tr><td style="padding:14px 32px 6px">${dataTable(rows)}</td></tr>
      <tr><td style="padding:18px 32px 16px">${button(crmLink, t.button)}</td></tr>`;
  return layout({ kicker: t.kicker, bodyHtml: body, lang });
}

// ---------------- Transporte ----------------
// RESEND_API_URL existe solo para apuntar a un stub local en pruebas (como RECAPTCHA_VERIFY_URL); no definirla en Vercel.
const apiUrl = () => String(process.env.RESEND_API_URL || API).replace(/\/+$/, '');
async function post(url, payload, tag) {
  const key = apiKey();
  if (!key) return { ok: false, skipped: true };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (!resp.ok) {
      console.error(`[email] ${tag}`, resp.status, JSON.stringify(data || '').slice(0, 300));
      return { ok: false, status: resp.status, error: (data && (data.message || data.error)) || `HTTP ${resp.status}` };
    }
    return { ok: true, id: data && data.id ? String(data.id) : null, data };
  } catch (e) {
    console.error(`[email] ${tag} fallo de red:`, e?.message || e);
    return { ok: false, error: String(e?.message || e) };
  }
}
const recipients = (to) => (Array.isArray(to) ? to : [to]).map((x) => String(x || '').trim()).filter(Boolean);

// Enlace de acceso, en el idioma del usuario. Devuelve { ok:true, id } si Resend lo aceptó; { ok:false, ... } en error o sin key.
export async function sendMagicLink({ to, name, link, lang = 'es' }) {
  if (!apiKey()) { console.log('[email] Sin RESEND_API_KEY — link (solo dev):', link); return { ok: false, skipped: true }; }
  const rcpt = recipients(to);
  if (!rcpt.length) return { ok: false, skipped: true };
  return post(apiUrl(), {
    from: fromAddress(), to: rcpt,
    subject: T[L(lang)].magic.subject,
    html: magicLinkHtml({ name: name || '', link: String(link || ''), lang }),
  }, `magic-link(${L(lang)})`);
}

// Notifica a los administradores (y correos extra) cuando entra un lead. Fotos como adjuntos base64.
// files: [{ name, mime, data }] con data = base64 sin prefijo. `to` = destinatarios que comparten `lang`. Best-effort: nunca lanza.
export async function sendLeadNotification({ to, lead, files, crmLink, lang = 'es' }) {
  const rcpt = recipients(to);
  if (!apiKey() || !rcpt.length) return { ok: false, skipped: true };
  const t = T[L(lang)].lead;
  const l = lead || {};
  const name = l.name || t.newContact;
  const isContact = l.source === 'contact';
  const svc = l.service_label || l.service || (isContact ? t.svcContact : t.svcQuote);
  const attachments = (Array.isArray(files) ? files : [])
    .filter((f) => f && f.data)
    .slice(0, 6)
    .map((f, i) => {
      const ext = /png/i.test(f.mime || '') ? 'png' : /webp/i.test(f.mime || '') ? 'webp' : 'jpg';
      const fname = String(f.name || `foto-${i + 1}.${ext}`).replace(/[^\w.\-]+/g, '_').slice(0, 80) || `foto-${i + 1}.${ext}`;
      const a = { filename: fname, content: String(f.data) };
      if (f.mime) a.content_type = String(f.mime);
      return a;
    });
  const payload = {
    from: fromAddress(), to: rcpt,
    subject: t.subject(name, svc, isContact),
    html: leadNotifyHtml({ lead: l, crmLink: crmLink || '', photoCount: attachments.length, lang }),
  };
  if (attachments.length) payload.attachments = attachments;
  if (l.email) payload.reply_to = l.email;
  return post(apiUrl(), payload, `lead-notify(${L(lang)})`);
}

// Recordatorio de tarea. Con scheduledAt (ISO) lo programa en Resend (scheduled_at) y devuelve { ok, id }.
export async function sendTaskReminder({ to, task, lead, crmLink, scheduledAt, lang = 'es' }) {
  const rcpt = recipients(to);
  if (!apiKey() || !rcpt.length || !task) return { ok: false, skipped: true };
  const leadName = (lead && lead.name) || 'Lead';
  const payload = {
    from: fromAddress(), to: rcpt,
    subject: T[L(lang)].task.subject(task.title, leadName),
    html: taskReminderHtml({ task, lead: lead || {}, crmLink: crmLink || '', lang }),
  };
  if (scheduledAt) {
    const d = new Date(scheduledAt);
    if (isNaN(d.getTime())) return { ok: false, error: 'scheduledAt inválido' };
    payload.scheduled_at = d.toISOString();
  }
  const r = await post(apiUrl(), payload, `${scheduledAt ? 'task-reminder(scheduled)' : 'task-reminder'}(${L(lang)})`);
  return { ok: !!r.ok, id: r.id || null, ...(r.ok ? {} : { error: r.error, status: r.status, skipped: r.skipped }) };
}

// Cancela un correo programado (POST /emails/:id/cancel). Nunca lanza.
export async function cancelScheduledEmail(id) {
  const eid = String(id || '').trim();
  if (!eid || !apiKey()) return { ok: false, skipped: true };
  return post(`${apiUrl()}/${encodeURIComponent(eid)}/cancel`, undefined, 'cancel-scheduled');
}
