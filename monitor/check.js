// Comprueba los módulos de GlobalEduca, guarda el resultado en docs/data/status.json,
// hace captura de pantalla de cada módulo que falla y envía un correo si empieza una caída.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const DATA_FILE = path.join(DOCS, 'data', 'status.json');
const SHOTS_DIR = path.join(DOCS, 'screenshots');
const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

const USER = (process.env.GE_USER || config.user || '').trim();
const PASS = process.env.GE_PASSWORD;
const TRIGGER = process.env.TRIGGER === 'workflow_dispatch' ? 'manual'
  : process.env.TRIGGER === 'schedule' ? 'automatica' : (process.env.TRIGGER || 'local');

if (!PASS) {
  console.error('Falta el secreto GE_PASSWORD. Créalo en Settings > Secrets and variables > Actions.');
  process.exit(1);
}

console.log(`Usuario: "${USER}" (${process.env.GE_USER ? 'variable GE_USER' : 'config.json'})`);
if (PASS !== PASS.trim()) console.warn('AVISO: el secreto GE_PASSWORD empieza o termina con espacios o saltos de línea.');

const LOGIN_FAILED = 'LOGIN_FAILED';
let loginBroken = false; // si el acceso falla una vez, no se reintenta en esta ejecución (evita bloquear la cuenta)

const settle = (page) => page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
const visible = (loc) => loc.isVisible().catch(() => false);

// Devuelve el primer elemento visible que cumpla el selector (o null)
async function firstVisible(page, selector) {
  const loc = page.locator(selector);
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await visible(el)) return el;
  }
  return null;
}

async function hasLoginForm(page) {
  return !!(await firstVisible(page, config.selectors.password));
}

async function login(page) {
  const pass = await firstVisible(page, config.selectors.password);
  const user = (await firstVisible(page, config.selectors.user)) || (await firstVisible(page,
    "input[type=text], input[type=email], input:not([type])"));
  if (!user) throw new Error('No se encuentra el campo de usuario en la pantalla de acceso.');
  const before = new Set((await page.locator('body').innerText().catch(() => '')).split('\n').map((l) => l.trim()));
  // Se teclea carácter a carácter (como una persona): algunos formularios solo leen el valor en eventos de teclado
  await user.click({ timeout: 10000 });
  await user.fill('');
  await user.pressSequentially(USER, { delay: 40 });
  await pass.click({ timeout: 10000 });
  await pass.fill('');
  await pass.pressSequentially(PASS, { delay: 40 });
  await pass.press('Tab').catch(() => {});
  // Se prueba cada selector en orden, para pulsar "Iniciar sesión" y nunca "Iniciar sesión con Google/Microsoft"
  let submit = null, how = 'tecla Enter';
  for (const sel of config.selectors.submit) {
    submit = await firstVisible(page, sel);
    if (submit) { how = `botón "${(await submit.innerText().catch(() => '')).trim() || sel}"`; break; }
  }
  console.log(`  Login: campo usuario "${await user.getAttribute('name').catch(() => '?')}", envío con ${how}`);
  if (submit) await submit.click();
  else await pass.press('Enter');
  await page.waitForLoadState('domcontentloaded', { timeout: config.timeoutMs }).catch(() => {});
  await settle(page);
  if (await hasLoginForm(page)) {
    loginBroken = true;
    const after = (await page.locator('body').innerText().catch(() => '')).split('\n').map((l) => l.trim());
    const msg = after.filter((l) => l && !before.has(l)).join(' ').slice(0, 200);
    const err = new Error(`El acceso con ${USER} no se completó: sigue apareciendo la pantalla de login.`
      + (msg ? ` Mensaje de la página: ${msg}` : ' La página no muestra ningún mensaje nuevo.'));
    err.code = LOGIN_FAILED;
    throw err;
  }
}

// Cierra la sesión si encuentra el enlace (solo se permite una sesión activa por usuario)
async function logout(page) {
  for (const sel of config.selectors.logout || []) {
    const el = await firstVisible(page, sel);
    if (el) {
      await el.click({ timeout: 5000 }).catch(() => {});
      await settle(page);
      return true;
    }
  }
  return false;
}

async function attempt(context, mod, stamp) {
  const page = await context.newPage();
  const started = Date.now();
  const result = { id: mod.id, ok: false, http: null, ms: null, error: null, screenshot: null };
  try {
    const resp = await page.goto(mod.url, { waitUntil: 'domcontentloaded', timeout: config.timeoutMs });
    result.http = resp ? resp.status() : null;
    if (resp && resp.status() >= 400) throw new Error(`El servidor responde HTTP ${resp.status()}`);
    await settle(page);

    if (await hasLoginForm(page)) {
      if (loginBroken) {
        const err = new Error('No se intenta el acceso porque ya falló en otro módulo en esta comprobación.');
        err.code = LOGIN_FAILED;
        throw err;
      }
      await login(page);
    }

    const text = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    const lower = text.toLowerCase();
    const hit = config.errorTexts.find((t) => lower.includes(t.toLowerCase()));
    if (hit) throw new Error(`La página muestra un error: "${hit}"`);
    if (text.trim().length < config.minBodyChars) throw new Error('La página carga en blanco.');
    result.ok = true;
    result.loggedOut = await logout(page);
  } catch (e) {
    result.error = String((e && e.message) || e).split('\n')[0].slice(0, 300);
    result.code = e && e.code;
    try {
      const file = `${stamp}_${mod.id}.jpg`;
      await page.screenshot({ path: path.join(SHOTS_DIR, file), type: 'jpeg', quality: 60, timeout: 15000 });
      result.screenshot = `screenshots/${file}`;
    } catch (_) { /* sin captura si la página ni siquiera se pudo abrir */ }
  } finally {
    result.ms = Date.now() - started;
    await page.close().catch(() => {});
  }
  return result;
}

async function checkModule(context, mod, stamp) {
  let res;
  for (let i = 0; i <= config.retries; i++) {
    if (res && res.screenshot) fs.rmSync(path.join(DOCS, res.screenshot), { force: true });
    res = await attempt(context, mod, stamp);
    if (res.ok || res.code === LOGIN_FAILED) break;
    if (i < config.retries) await new Promise((r) => setTimeout(r, 5000));
  }
  delete res.code;
  console.log(`${res.ok ? 'OK  ' : 'FALLA'} ${mod.name.padEnd(9)} ${res.ms} ms ${res.error || ''}`);
  return res;
}

function loadData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { runs: [] }; }
}

function pruneScreenshots(data) {
  const keep = new Set();
  data.runs.forEach((r) => r.modules.forEach((m) => m.screenshot && keep.add(path.basename(m.screenshot))));
  for (const f of fs.readdirSync(SHOTS_DIR)) {
    if (f.endsWith('.jpg') && !keep.has(f)) fs.rmSync(path.join(SHOTS_DIR, f));
  }
}

async function sendAlert(run) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.warn('Correo no enviado: faltan los secretos SMTP_HOST, SMTP_USER o SMTP_PASS.');
    return 'Faltan los datos del servidor de correo';
  }
  const names = Object.fromEntries(config.modules.map((m) => [m.id, m]));
  const when = new Date(run.t).toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  const summary = run.overall === 'down' ? 'Ningún módulo responde.' : 'Algún módulo no funciona.';
  const lines = run.modules.map((m) =>
    `${m.ok ? 'OK   ' : 'FALLA'}  ${names[m.id].name}  ${names[m.id].url}${m.ok ? '' : `\n       ${m.error}`}`);
  const text = `${summary}\nComprobación: ${when} (${run.trigger})\n\n${lines.join('\n')}\n\nPágina de estado: ${config.statusPageUrl}\n`;
  const port = Number(SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const attachments = run.modules.filter((m) => m.screenshot)
    .map((m) => ({ filename: `${m.id}.jpg`, path: path.join(DOCS, m.screenshot) }));
  try {
    await transporter.sendMail({
      from: MAIL_FROM || SMTP_USER, to: config.alertTo, subject: config.alertSubject, text, attachments,
    });
    console.log(`Correo "${config.alertSubject}" enviado a ${config.alertTo}`);
    return null;
  } catch (e) {
    console.error('Error enviando el correo:', e.message);
    return e.message.slice(0, 200);
  }
}

(async () => {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1366, height: 850 }, locale: 'es-ES', timezoneId: 'Europe/Madrid',
  });
  const results = [];
  for (const mod of config.modules) results.push(await checkModule(context, mod, stamp));
  await browser.close();

  const okCount = results.filter((r) => r.ok).length;
  const overall = okCount === results.length ? 'ok' : okCount === 0 ? 'down' : 'partial';
  const run = { t: now.toISOString(), trigger: TRIGGER, overall, modules: results };

  const data = loadData();
  const prev = data.runs[data.runs.length - 1];
  const failing = (r) => r.modules.filter((m) => !m.ok).map((m) => m.id).sort().join(',');
  const newIncident = overall !== 'ok' && (!prev || prev.overall === 'ok' || failing(prev) !== failing(run));
  if (newIncident) {
    const err = await sendAlert(run);
    run.alert = err ? { sent: false, error: err } : { sent: true };
  }

  const cutoff = now.getTime() - config.retentionHours * 3600e3;
  data.modules = config.modules;
  data.runs = [...data.runs, run].filter((r) => Date.parse(r.t) >= cutoff);
  data.updated = now.toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  pruneScreenshots(data);
  console.log(`Estado general: ${overall} (${okCount}/${results.length} módulos OK)`);
})().catch((e) => { console.error(e); process.exit(1); });
