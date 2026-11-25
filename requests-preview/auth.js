/* Real logins for the app (preview only until Michael OKs): sign-in screen, Sign out, and the Team screen.
   Talks to the chat worker's /api/auth/*. The session token is stored where the old ?k= key is stored (localStorage abf_k),
   so the rest of the app keeps working unchanged. Old ?k= links keep working. No invites are sent unless "Send sign-in email" is ticked. */
(function () {
  var CHAT = 'https://buildflowai-chat.mekovacs22.workers.dev';
  var q = new URLSearchParams(location.search);
  function st(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tok() { return q.get('k') || st('abf_k') || ''; }
  function api(path, method, body) {
    return fetch(CHAT + '/api/auth/' + path, { method: method || 'GET', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok() }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d._status = r.status; return d; }); });
  }
  function injectCss() {
    if (document.getElementById('tm-css')) return;
    var s = document.createElement('style'); s.id = 'tm-css';
    s.textContent = '#si{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:var(--bg,#0e1511);color:var(--ink,#f2ebdd);font:16px/1.4 system-ui,-apple-system,sans-serif;padding:16px}' +
      '#si .c{width:100%;max-width:380px;border:1px solid var(--line,rgba(255,255,255,.18));border-radius:16px;padding:24px;background:var(--card,rgba(255,255,255,.04))}' +
      '#si h1{font-size:22px;margin:0 0 4px}#si p{margin:6px 0 14px;opacity:.8;font-size:14px}#si input{width:100%;box-sizing:border-box;background:transparent;border:1px solid var(--line2,rgba(255,255,255,.3));border-radius:10px;padding:12px;color:inherit;font:inherit;font-size:16px;margin:6px 0}' +
      '#si button,.tm button{font:inherit;font-size:15px;min-height:44px;border-radius:10px;border:1px solid var(--line2,rgba(255,255,255,.3));background:none;color:inherit;padding:8px 14px;cursor:pointer}' +
      '#si .go,.tm .go{background:var(--accent,#c9a96b);color:var(--bg,#0e1511);border-color:transparent;font-weight:600}#si .go{width:100%}' +
      '#si .or{text-align:center;opacity:.6;font-size:13px;margin:12px 0}#si .msg{min-height:20px;font-size:14px;margin-top:10px}#si .msg.bad{color:#f0a0a0}' +
      '.tm{margin:0 0 12px}.tm .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:space-between;margin:0 0 10px}.tm h2{font-size:16px;margin:0}' +
      '.tm .who{font-size:13px;opacity:.75}.tm .me{display:flex;gap:10px;align-items:center;flex-wrap:wrap}' +
      '.tm .pl{display:grid;gap:8px}.tm .pc{display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;text-align:left;width:100%;border:1px solid var(--line,rgba(255,255,255,.14));border-radius:12px;padding:10px 12px;background:none;color:inherit;min-height:56px}' +
      '.tm .pc small{opacity:.7;font-size:12.5px;grid-column:1/2}.tm .pc .tag{grid-row:1/3;grid-column:2;font-size:12px;border:1px solid var(--line2,rgba(255,255,255,.3));border-radius:999px;padding:3px 10px;white-space:nowrap}' +
      '.tm .off{opacity:.55}.tm form{display:grid;gap:10px;border:1px solid var(--line2,rgba(255,255,255,.3));border-radius:14px;padding:14px;margin:0 0 12px}' +
      '.tm label{display:grid;gap:4px;font-size:13px;opacity:.9}.tm input[type=text],.tm input[type=email],.tm select{width:100%;box-sizing:border-box;background:transparent;border:1px solid var(--line2,rgba(255,255,255,.3));border-radius:10px;padding:10px;color:inherit;font:inherit;font-size:16px}' +
      '.tm select option{color:#000}.tm .ck{display:flex;align-items:center;gap:10px;min-height:36px;font-size:14px;opacity:1}.tm .ck input{width:20px;height:20px;flex:none}' +
      '.tm fieldset{border:1px solid var(--line,rgba(255,255,255,.14));border-radius:10px;padding:8px 12px;margin:0}.tm legend{font-size:12px;opacity:.75;padding:0 6px}.tm .note{font-size:12.5px;opacity:.7}' +
      '.tm .jb{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:0 12px}.tm .bar{display:flex;gap:8px;flex-wrap:wrap}.tm .msg{font-size:13.5px;min-height:18px}.tm .msg.bad{color:#f0a0a0}.tm .msg.ok{color:#9fd8a8}' +
      '.tm hr{border:0;border-top:1px solid var(--line,rgba(255,255,255,.14));margin:14px 0}';
    document.head.appendChild(s);
  }

  // ---------------- sign-in ----------------
  function overlay(inner) {
    injectCss();
    var o = document.getElementById('si');
    if (!o) { o = document.createElement('div'); o.id = 'si'; document.body.appendChild(o); }
    o.innerHTML = '<div class="c">' + inner + '</div>'; return o;
  }
  function setMsg(t, bad) { var m = document.querySelector('#si .msg'); if (m) { m.textContent = t || ''; m.className = 'msg' + (bad ? ' bad' : ''); } }
  function done(token) { st('abf_k', token); var u = new URL(location.href); u.searchParams.delete('login'); location.replace(u.pathname + (u.search || '') + u.hash); }

  function loadGsi(cid, cb) {
    if (window.google && google.accounts && google.accounts.id) return cb();
    var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = cb; s.onerror = function () { }; document.head.appendChild(s);
  }
  function showSignIn(note) {
    overlay('<h1>Sign in</h1><p>' + esc(note || 'Use the Google account or email the company added for you.') + '</p><div id="si-g" style="min-height:44px;display:flex;justify-content:center"></div><div class="or" id="si-or" hidden>or</div>' +
      '<input id="si-e" type="email" inputmode="email" autocomplete="email" placeholder="you@company.com"><button class="go" id="si-b" type="button">Email me a link</button><div class="msg" role="status"></div>');
    var email = document.getElementById('si-e');
    document.getElementById('si-b').onclick = function () {
      var v = (email.value || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { setMsg('Type your email address first.', true); return; }
      setMsg('Sending…'); fetch(CHAT + '/api/auth/link/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: v, return_to: location.origin + location.pathname }) })
        .then(function (r) { return r.json(); }).then(function () { setMsg('If that email is set up, a sign-in link is on its way. It works once, for 15 minutes.'); }).catch(function () { setMsg('Could not reach the server. Try again.', true); });
    };
    fetch(CHAT + '/api/auth/config').then(function (r) { return r.json(); }).then(function (c) {
      if (!c.email_link) { document.getElementById('si-b').hidden = true; email.hidden = true; }
      if (!c.google_client_id) return;
      loadGsi(c.google_client_id, function () {
        try {
          google.accounts.id.initialize({ client_id: c.google_client_id, callback: function (resp) {
            setMsg('Checking…');
            fetch(CHAT + '/api/auth/google', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: resp.credential }) })
              .then(function (r) { return r.json(); }).then(function (d) { if (d.token) done(d.token); else setMsg(d.error || 'Sign-in did not work.', true); }).catch(function () { setMsg('Could not reach the server.', true); });
          } });
          google.accounts.id.renderButton(document.getElementById('si-g'), { theme: 'filled_black', size: 'large', text: 'signin_with', width: 280 });
          if (c.email_link) document.getElementById('si-or').hidden = false;
        } catch (e) { }
      });
    }).catch(function () { });
  }
  window.bfSignOut = function () {
    api('logout', 'POST').catch(function () { }).then(function () { st('abf_k', null); var u = new URL(location.href); u.searchParams.delete('k'); location.replace(u.pathname + (u.search || '')); });
  };

  var code = q.get('login');
  if (code) {
    document.addEventListener('DOMContentLoaded', function () {
      overlay('<h1>Signing you in…</h1><div class="msg" role="status"></div>');
      fetch(CHAT + '/api/auth/link/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code }) })
        .then(function (r) { return r.json(); }).then(function (d) { if (d.token) done(d.token); else { var u = new URL(location.href); u.searchParams.delete('login'); history.replaceState(null, '', u.pathname + u.search); showSignIn(d.error || 'That link has expired or was already used.'); } })
        .catch(function () { showSignIn('Could not reach the server. Try again.'); });
    });
  } else if (!tok()) {
    document.addEventListener('DOMContentLoaded', function () { showSignIn(); });
  } else if (/^bf_/.test(tok())) {   // signed in with a real login: check it still works; a turned-off or expired login goes back to sign-in
    document.addEventListener('DOMContentLoaded', function () {
      api('me').then(function (d) { if (d._status === 401) { st('abf_k', null); showSignIn('You are signed out. Sign in again.'); } });
    });
  }

  // ---------------- Team screen (Contacts > Internal Users) ----------------
  var PERM = { manage_logins: 'Manage the team', approve_money: 'Approve money', create_invoices: 'Create invoices', edit_bills_pos: 'Edit bills and POs', edit_budget: 'Edit the budget', edit_schedule: 'Edit the schedule', admin_cards: 'Admin and accounting cards' };
  var T = { el: null, data: null, editing: null, msg: '', msgBad: false, me: null, vis: null, visJob: '' };

  function jobsList() { try { return (window.dashJobs ? window.dashJobs() : []).filter(function (j) { return !/^zz-/.test(j.id); }); } catch (e) { return []; } }
  function saying(t, bad) { T.msg = t || ''; T.msgBad = !!bad; }

  function load() {
    return Promise.all([api('users'), api('me')]).then(function (r) { var u = r[0]; T.me = r[1]; if (u._status !== 200) { T.data = null; T.err = u.error || 'Not allowed.'; return; } T.data = u; T.err = ''; });
  }
  function roleLabel(role) { var a = (T.data && T.data.assignable || []).filter(function (x) { return x.role === role; })[0]; return a ? a.label : role; }
  function jobsText(p) { if (p.jobs === 'all') return 'All jobs'; var n = (p.jobs || []).length; return n ? n + (n === 1 ? ' job' : ' jobs') : 'No jobs yet'; }

  function listHtml() {
    var ppl = (T.data.people || []).slice().sort(function (a, b) { return (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0) || String(a.name || a.email).localeCompare(String(b.name || b.email)); });
    return '<div class="pl">' + (ppl.map(function (p, i) {
      return '<button type="button" class="pc' + (p.disabled ? ' off' : '') + '" data-ed="' + i + '"><b>' + esc(p.name || p.email) + '</b><span class="tag">' + esc(p.disabled ? 'Turned off' : (p.role_label || roleLabel(p.role))) + '</span><small>' + esc(p.email) + ' · ' + esc(jobsText(p)) + (p.trade ? ' · ' + esc(p.trade) : '') + '</small></button>';
    }).join('') || '<p class="note">No one has a login yet. Add the first person.</p>') + '</div>';
  }

  function formHtml(p) {
    var isNew = !p.email, as = T.data.assignable || [], r = p.role || (as[0] && as[0].role) || 'field';
    var cur = as.filter(function (x) { return x.role === r; })[0] || {};
    var selfEdit = T.me && T.me.email && p.email && String(T.me.email).toLowerCase() === String(p.email).toLowerCase();
    var roleSel = '<select name="role"' + (selfEdit ? ' disabled' : '') + '>' + as.map(function (x) { return '<option value="' + esc(x.role) + '"' + (x.role === r ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('') + (as.some(function (x) { return x.role === r; }) ? '' : '<option value="' + esc(r) + '" selected>' + esc(p.role_label || r) + '</option>') + '</select>';
    var allJobs = p.jobs === 'all' || (isNew && (cur.all_jobs || !cur.sub));
    var js = jobsList(), picked = Array.isArray(p.jobs) ? p.jobs : [];
    var eff = p.effective_perms || cur.defaults || {};
    var perms = Object.keys(PERM).filter(function (k) { return k in eff || !isNew; }).map(function (k) { return '<label class="ck"><input type="checkbox" name="perm_' + k + '"' + (eff[k] ? ' checked' : '') + '><span>' + esc(PERM[k]) + '</span></label>'; }).join('');
    var audience = (cur.sub || r === 'sub') ? 'sub' : 'internal', fe = T.data.features || {};
    var feats = Object.keys(fe).filter(function (k) { return (fe[k].audiences || []).indexOf(audience) >= 0; }).map(function (k) {
      var on = p.features && k in p.features ? p.features[k] : fe[k].default !== false;
      return '<label class="ck"><input type="checkbox" name="feat_' + k + '"' + (on ? ' checked' : '') + '><span>' + esc(fe[k].label || k) + '</span></label>';
    }).join('');
    return '<form id="tm-f" data-new="' + (isNew ? 1 : 0) + '"><h2>' + (isNew ? 'Add a person' : esc(p.name || p.email)) + '</h2>' +
      '<label>Name<input type="text" name="name" value="' + esc(p.name || '') + '" autocomplete="off"></label>' +
      '<label>Email<input type="email" name="email" value="' + esc(p.email || '') + '"' + (isNew ? '' : ' readonly') + ' autocomplete="off" inputmode="email"></label>' +
      '<label>Role' + roleSel + '</label><div class="note" id="tm-rn">' + esc(cur.note || '') + '</div>' +
      '<label id="tm-tr"' + (r === 'sub' || cur.sub ? '' : ' hidden') + '>Trade<input type="text" name="trade" value="' + esc(p.trade || '') + '" placeholder="Framing, roofing…"></label>' +
      '<fieldset><legend>Jobs</legend><label class="ck"><input type="checkbox" name="alljobs"' + (allJobs ? ' checked' : '') + '><span>All jobs</span></label><div class="jb" id="tm-jb"' + (allJobs ? ' hidden' : '') + '>' +
      js.map(function (j) { return '<label class="ck"><input type="checkbox" name="job" value="' + esc(j.id) + '"' + (picked.indexOf(j.id) >= 0 ? ' checked' : '') + '><span>' + esc(j.name) + '</span></label>'; }).join('') + '</div></fieldset>' +
      (perms ? '<fieldset><legend>What they can do</legend>' + perms + '</fieldset>' : '') +
      (feats ? '<fieldset><legend>What they can see</legend>' + feats + '</fieldset>' : '') +
      '<label class="ck"><input type="checkbox" name="invite"><span>Send a sign-in email now' + (T.data.mail ? '' : ' (email is not set up yet)') + '</span></label>' +
      '<div class="note">Nothing is emailed unless this is ticked. They can sign in later with Google or an emailed link.</div>' +
      '<div class="bar"><button type="submit" class="go">' + (isNew ? 'Add person' : 'Save') + '</button><button type="button" data-x="cancel">Cancel</button>' +
      (!isNew && !selfEdit ? (p.disabled ? '<button type="button" data-x="on">Turn login back on</button>' : '<button type="button" data-x="off">Turn off login</button>') : '') + '</div><div class="msg' + (T.msgBad ? ' bad' : '') + '">' + esc(T.msg) + '</div></form>';
  }

  function visHtml() {
    var js = jobsList(); if (!js.length) return '';
    var h = '<hr><h2>What clients see</h2><p class="note">Per job: switch off anything a client should not see in their portal. The portal reads these settings.</p><label>Job<select id="tm-vj"><option value="">Pick a job…</option>' + js.map(function (j) { return '<option value="' + esc(j.id) + '"' + (T.visJob === j.id ? ' selected' : '') + '>' + esc(j.name) + '</option>'; }).join('') + '</select></label>';
    if (T.vis && T.visJob) {
      h += '<div class="jb" style="margin-top:8px">' + Object.keys(T.vis.catalog || {}).map(function (k) { return '<label class="ck"><input type="checkbox" data-vk="' + esc(k) + '"' + (T.vis.client_features[k] ? ' checked' : '') + '><span>' + esc(T.vis.catalog[k]) + '</span></label>'; }).join('') + '</div><div class="msg' + (T.visBad ? ' bad' : ' ok') + '">' + esc(T.visMsg || '') + '</div>';
    }
    return h;
  }

  function draw() {
    var el = T.el; if (!el || !document.body.contains(el)) return;
    if (!T.data) return;   // keep the plain list the dashboard drew
    var me = T.me || {};
    el.innerHTML = '<div class="tm"><div class="row"><div class="me"><span class="who">Signed in as ' + esc(me.name || me.email || 'you') + (me.label ? ' · ' + esc(me.label) : '') + '</span>' + (/^bf_/.test(tok()) ? '<button type="button" data-x="out">Sign out</button>' : '') + '</div>' +
      (T.editing ? '' : '<button type="button" class="go" data-x="add">Add person</button>') + '</div>' +
      (T.editing ? formHtml(T.editing) : listHtml() + (T.msg ? '<div class="msg' + (T.msgBad ? ' bad' : ' ok') + '">' + esc(T.msg) + '</div>' : '')) + (T.editing ? '' : visHtml()) + '</div>';
  }

  function submit(f) {
    var fd = new FormData(f), get = function (n) { return String(fd.get(n) || '').trim(); };
    var email = get('email').toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { saying('Type a valid email.', true); return draw(); }
    var p = T.editing || {}, roleEl = f.elements.role, role = roleEl.disabled ? p.role : roleEl.value;
    var body = { email: email, name: get('name'), role: role, trade: get('trade') };
    body.jobs = f.elements.alljobs.checked ? 'all' : Array.prototype.filter.call(f.querySelectorAll('input[name=job]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
    var perms = {}, feats = {};
    Array.prototype.forEach.call(f.elements, function (e) { if (/^perm_/.test(e.name)) perms[e.name.slice(5)] = e.checked; if (/^feat_/.test(e.name)) feats[e.name.slice(5)] = e.checked; });
    body.perms = perms; body.features = feats;
    if (f.elements.invite.checked) { body.invite = true; body.return_to = location.origin + location.pathname; }
    saying('Saving…'); draw();
    api('users', 'POST', body).then(function (d) {
      if (d._status !== 200 || d.error) { saying(d.error || 'Could not save.', true); return draw(); }
      T.editing = null; saying('Saved.' + (d.invited ? ' Sign-in email sent.' : '')); return load().then(draw);
    });
  }

  function onClick(e) {
    var t = e.target.closest('[data-ed],[data-x]'); if (!t) return;
    var x = t.getAttribute('data-x');
    if (t.hasAttribute('data-ed')) { T.editing = T.data.people[+t.getAttribute('data-ed')] || null; var sorted = (T.data.people || []).slice().sort(function (a, b) { return (a.disabled ? 1 : 0) - (b.disabled ? 1 : 0) || String(a.name || a.email).localeCompare(String(b.name || b.email)); }); T.editing = sorted[+t.getAttribute('data-ed')]; saying(''); return draw(); }
    if (x === 'out') return window.bfSignOut();
    if (x === 'add') { T.editing = {}; saying(''); return draw(); }
    if (x === 'cancel') { T.editing = null; saying(''); return draw(); }
    if (x === 'off') {   // two taps instead of a browser pop-up
      if (t.getAttribute('data-sure') !== '1') { t.setAttribute('data-sure', '1'); t.textContent = 'Tap again to turn off'; return; }
      return api('users', 'DELETE', { email: T.editing.email }).then(function (d) { if (d._status !== 200 || d.error) { saying(d.error || 'Could not turn off.', true); return draw(); } T.editing = null; saying('Login turned off. History is kept. Reassign their open to-dos and schedule items.'); return load().then(draw); });
    }
    if (x === 'on') { return api('users', 'POST', { email: T.editing.email, disabled: false }).then(function (d) { if (d._status !== 200 || d.error) { saying(d.error || 'Could not turn on.', true); return draw(); } T.editing = null; saying('Login is back on.'); return load().then(draw); }); }
  }
  function onChange(e) {
    var t = e.target;
    if (t.name === 'alljobs') { var jb = document.getElementById('tm-jb'); if (jb) jb.hidden = t.checked; }
    if (t.name === 'role' && T.editing) { var cur = (T.data.assignable || []).filter(function (a) { return a.role === t.value; })[0] || {}; var n = document.getElementById('tm-rn'); if (n) n.textContent = cur.note || ''; var tr = document.getElementById('tm-tr'); if (tr) tr.hidden = !(cur.sub || t.value === 'sub'); var aj = document.querySelector('#tm-f input[name=alljobs]'); if (aj && cur.all_jobs) { aj.checked = true; document.getElementById('tm-jb').hidden = true; } }
    if (t.id === 'tm-vj') { T.visJob = t.value; T.vis = null; T.visMsg = ''; if (!t.value) return draw(); api('visibility?job=' + encodeURIComponent(t.value)).then(function (d) { if (d._status === 200) T.vis = d; else { T.visMsg = d.error || 'Could not load.'; T.visBad = true; } draw(); }); }
    if (t.hasAttribute && t.hasAttribute('data-vk')) {
      var cf = {}; Array.prototype.forEach.call(document.querySelectorAll('[data-vk]'), function (c) { cf[c.getAttribute('data-vk')] = c.checked; });
      api('visibility', 'POST', { job: T.visJob, client_features: cf }).then(function (d) { T.visBad = d._status !== 200 || !!d.error; T.visMsg = T.visBad ? (d.error || 'Could not save.') : 'Saved.'; if (!T.visBad && T.vis) T.vis.client_features = cf; draw(); });
    }
  }

  window.teamMount = function (el) {
    T.el = el; if (!el._tm) { el._tm = 1; el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('submit', function (e) { e.preventDefault(); submit(e.target); }); }
    if (!tok()) return;
    load().then(draw).catch(function () { });
  };
})();
