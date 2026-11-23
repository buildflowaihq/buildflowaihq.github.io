// Browser smoke test for the BuildFlowAI app preview. DRY RUN: every network call is mocked, so nothing is sent, filed or written
// anywhere real. Fails on ANY console error / uncaught exception, and checks the chat essentials still work with a SAVED CHAT that
// already holds draft cards (the v3 crash: page died on load, killing the chat and mic).
// Run: node smoke.mjs [pagePath]   (default requests-preview/app.html). Needs: npm i playwright && npx playwright install chromium
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = process.argv[2] || 'requests-preview/app.html';
const KEY = 'smoketestkey0123456789abcdef';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json', '.m4a': 'audio/mp4' };
const srv = http.createServer((q, s) => { const p = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end('nf'); } s.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(fs.readFileSync(p)); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;

const fails = [], log = [], rec = { chat: [], mail: [], meeting: [], filed: [], todoOps: [], external: [] };
const check = (ok, what) => { (ok ? log : fails).push((ok ? 'ok   ' : 'FAIL ') + what); };
const iso = new Date().toISOString();
const emailCard = { type: 'email', to: [{ name: 'Test', email: 'test@example.com' }], subject: 'Harriet proposal', body: "Hi,\n\nI've attached the latest Harriet proposal.\n\nKyle", note: 'Picked the newest.', attachments: [{ title: '422 W Harriet Proposal.pdf', url: 'https://drive.google.com/file/d/abc/view' }] };
const meetCard = { type: 'meeting', title: 'Palm review', date: '2027-01-12', time: '14:00', minutes: 30, attendees: [{ name: 'Sam', email: 'sam@kdbla.com' }], note: 'Quick review' };
const chooseCard = { type: 'choose', question: 'Which Kyle?', options: [{ label: 'Kyle Kovacs', reply: 'Use kyle@kdbla.com' }, { label: 'Kyle Other', reply: 'Use other@example.com' }] };
const saved = [
  { role: 'user', text: 'send an email to test@example.com with the latest Harriet proposal' },
  { role: 'assistant', text: "Here's the email.", card: emailCard },
  { role: 'user', text: 'set up a meeting with sam' }, { role: 'assistant', text: "Here's the invite.", card: meetCard },
  { role: 'user', text: 'email kyle' }, { role: 'assistant', text: 'Which one?', card: chooseCard },
  { role: 'user', text: 'draft to mary' }, { role: 'assistant', text: 'Draft below.', mail: { to: 'mary@kdbla.com', to_name: 'Mary', subject: 'Hello', body: 'Hi Mary' } },
  { role: 'assistant', text: 'Sent card', card: { ...emailCard }, cardDone: 'Sent to x@y.com.' },
  { role: 'user', text: 'old request' }, { role: 'assistant', text: 'Got it. BuildFlowAI is on it.', req: 12 },
];
const chatReply = (last) => /meet|invite|call/i.test(last) ? "Here's the invite.\nSOURCES: general\nACTION_CARD: " + JSON.stringify(meetCard)
  : /which|choose/i.test(last) ? 'Pick one.\nSOURCES: general\nACTION_CARD: ' + JSON.stringify(chooseCard)
  : /email|send|framer/i.test(last) ? "Here's the email.\nSOURCES: general\nACTION_CARD: " + JSON.stringify(emailCard)
  : 'Hello! How can I help?\nSOURCES: general';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, permissions: ['microphone'] });
await ctx.addInitScript(({ key, saved }) => {
  try { localStorage.setItem('abf_k', key); localStorage.setItem('abf_chat_' + key.slice(0, 6), JSON.stringify(saved)); } catch (e) {}
  // fake dictation: starts, "hears" words, ends
  class FakeSR { start() { window.__srStarted = (window.__srStarted || 0) + 1; setTimeout(() => { this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'hello from the mic' }], { isFinal: true })] }); }, 30); } stop() { setTimeout(() => this.onend && this.onend(), 10); } abort() {} }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
  if (!navigator.mediaDevices) navigator.mediaDevices = {};
  navigator.mediaDevices.getUserMedia = async () => new MediaStream();
}, { key: KEY, saved });
const json = (route, o) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(o) });
await ctx.route('**/*', async (route) => {
  const req = route.request(), u = new URL(req.url());
  if (u.origin === base) return route.continue();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
  if (u.hostname.endsWith('workers.dev') && u.pathname === '/api/chat') {
    const body = JSON.parse(req.postData() || '{}'); rec.chat.push(body); const last = body.messages.at(-1).text;
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', headers: cors, body: chatReply(last) });
  }
  if (u.hostname === 'script.google.com') {
    if (req.method() === 'GET') {
      const a = u.searchParams.get('action');
      if (a === 'todos') return json(route, { ok: true, me: 'Kyle', admin: false, items: [{ id: 't1', title: 'Email the framer about the Harriet schedule', job: '422 W Harriet', person: 'Kyle', status: 'open', created: iso, updated: iso, detail: '', urgent: false }] });
      if (a === 'reqstatus') return json(route, { ok: true, s: {} });
      return json(route, { ok: true, name: 'Kyle' });
    }
    const b = JSON.parse(req.postData() || '{}');
    if (b.action === 'mail') { rec.mail.push(b); return json(route, { ok: true, attached: (b.mail.attachments || []).length }); }
    if (b.action === 'meeting') { rec.meeting.push(b); return json(route, { ok: true }); }
    if (b.action === 'todo') { rec.todoOps.push(b); return json(route, { ok: true }); }
    if (b.what) { rec.filed.push(b); return json(route, { ok: true, num: 9999 }); }   // recorded, never real
    return json(route, { ok: true });
  }
  rec.external.push(u.hostname); return json(route, { ok: false });                    // anything else: harmless empty answer
});
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const T = { timeout: 8000 };
try {
  await page.goto(`${base}/${PAGE}?k=${KEY}`, { waitUntil: 'load' });
  // 1. loads with the saved chat; drafts render
  await page.waitForSelector('#msgs .acard', T).catch(() => {});
  check(await page.locator('#msgs .acard').count() >= 3, 'saved chat renders its draft cards (email, invite, choice)');
  check(await page.locator('#msgs .mail').count() === 1, 'saved legacy email draft renders');
  check(await page.locator('#msgs .acard .ok').count() >= 1, 'sent card shows its done state');
  // 2. input box
  const box = page.locator('#what'); check(await box.isEnabled() && await box.isVisible(), 'input box is visible and enabled');
  check(await page.locator('#send').isEnabled(), 'send button is enabled after load');
  await box.fill('hello there'); check((await box.inputValue()) === 'hello there', 'can type in the box');
  // 3. mic
  await box.fill(''); await page.click('#mic'); await page.waitForFunction(() => (window.__srStarted || 0) > 0, null, T).catch(() => {});
  check((await page.evaluate(() => window.__srStarted || 0)) > 0, 'mic starts dictation');
  await page.waitForFunction(() => document.getElementById('what').value.includes('hello from the mic'), null, T).catch(() => {});
  check((await box.inputValue()).includes('hello from the mic'), 'mic words land in the box');
  check(await page.locator('#mic.on').count() === 1, 'mic shows listening state'); await page.click('#mic');
  check(await page.locator('#mic.on').count() === 0, 'mic stops when tapped again');
  // 4. send a message
  await box.fill('how is the weather today'); await page.click('#send');
  await page.waitForFunction(() => /How can I help/.test(document.getElementById('msgs').innerText), null, T).catch(() => {});
  check(/How can I help/.test(await page.locator('#msgs').innerText()), 'sending a message shows the reply');
  check(rec.chat.length === 1 && rec.chat[0].messages.at(-1).text === 'how is the weather today' && rec.chat[0].extras === true && rec.chat[0].team.length > 0, 'chat request carries history, extras and team');
  // 5. ask for an email -> draft card renders with fields, attachment, never raw JSON
  await box.fill('send an email to test@example.com with the latest Harriet proposal'); await page.click('#send');
  await page.waitForFunction(() => document.querySelectorAll('#msgs .acard').length >= 4, null, T).catch(() => {});
  const cards = page.locator('#msgs .acard'); const last = cards.last();
  check(await last.locator('input').first().inputValue() === 'test@example.com', 'new email draft shows the recipient');
  check((await last.locator('textarea').inputValue()).includes('attached'), 'new email draft shows the body');
  check(await last.locator('input[type=checkbox]').count() === 1, 'new email draft shows the attachment');
  const txt = await page.locator('#msgs').innerText();
  check(!/ACTION_CARD|"call"\s*:|"say"\s*:|SOURCES:/.test(txt), 'no raw JSON or control lines visible in the chat');
  // 6. Send in dry run -> goes only to the mocked endpoint
  await last.locator('button.pri', { hasText: 'Send' }).click();
  await page.waitForFunction(() => /Sent to test@example\.com/.test(document.getElementById('msgs').innerText), null, T).catch(() => {});
  check(rec.mail.length === 1 && rec.mail[0].mail.to[0] === 'test@example.com' && rec.mail[0].mail.attachments.length === 1, 'email Send posts to/subject/attachment (dry run, mocked)');
  const st = await page.locator('#msgs').innerText(); check(/Sent to test@example.com/.test(st), 'email Send shows the Sent confirmation');
  // 7. meeting card + Send; choice buttons
  await box.fill('set up a meeting with sam tomorrow'); await page.click('#send');
  await page.waitForFunction(() => document.querySelectorAll('#msgs .acard').length >= 5, null, T).catch(() => {});
  await page.locator('#msgs .acard').last().locator('button.pri', { hasText: 'Send' }).click();
  await page.waitForFunction(() => /Invite sent/.test(document.getElementById('msgs').innerText), null, T).catch(() => {});
  check(/Invite sent/.test(await page.locator('#msgs').innerText()), 'meeting Send shows the Invite sent confirmation');
  check(rec.meeting.length === 1 && rec.meeting[0].meeting.attendees.includes('sam@kdbla.com'), 'meeting Send posts the invite (dry run, mocked)');
  // 8. To-do tab + "Do it"
  await page.click('#tabTodo'); await page.waitForSelector('#todoList .item', T).catch(() => {});
  check(await page.locator('#todoList .item').count() === 1, 'To-do tab lists items');
  const before = rec.chat.length; await page.locator('#todoList button', { hasText: 'Do it' }).click();
  await page.waitForFunction((n) => true, before, T); await page.waitForTimeout(800);
  check(rec.chat.length === before + 1 && /Do this to-do/.test(rec.chat.at(-1).messages.at(-1).text), '"Do it" opens the chat and asks the agent');
  // 9. other tabs open without errors
  for (const t of ['#tabReq', '#tabDash', '#tabChat']) { await page.click(t); await page.waitForTimeout(250); }
  check(await page.locator('#what').isVisible(), 'tabs switch back to chat');
  // 10. reload with the now-bigger saved chat still works
  await page.reload({ waitUntil: 'load' }); await page.waitForSelector('#msgs .acard', T).catch(() => {});
  check(await page.locator('#what').isEnabled() && await page.locator('#msgs .acard').count() >= 4, 'reload with saved drafts keeps input and cards working');
  check(rec.filed.length === 0, 'nothing was filed as a request during the run (dry run)');
} catch (e) { fails.push('FAIL test crashed: ' + e.message); }
for (const e of errors) fails.push('FAIL ' + e);
await browser.close(); srv.close();
console.log(log.concat(fails).join('\n')); console.log(`\n${fails.length ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED'} (${log.length} ok, ${fails.length} failed; external calls mocked: ${[...new Set(rec.external)].join(', ') || 'none'})`);
process.exit(fails.length ? 1 : 0);
