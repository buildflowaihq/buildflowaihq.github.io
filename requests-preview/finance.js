/* BuildFlowAI Financial module: budget, purchase orders, change orders, invoices (modeled on the client's current job software).
   Defines only window.BFFinance.mount(el, {api, key, job, snap}). Nothing client-specific here; the client's names, numbers
   and rules come from the finance worker (per-client settings). Data never lives in this public repo. */
(function () {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var n2 = function (v) { var n = parseFloat(String(v == null ? '' : v).replace(/[$,%\s]/g, '')); return isNaN(n) ? 0 : n; };
  var r2 = function (n) { return Math.round(n * 100) / 100; };
  var money = function (v) { var n = r2(n2(v)); return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var ymd = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  var fdate = function (s) { var m = String(s || '').match(/^(\d{4})-(\d\d)-(\d\d)/); return m ? new Date(+m[1], m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; };
  var ftime = function (s) { var d = new Date(s); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };

  var S = { api: '', key: '', job: null, cfg: null, data: null, tab: 'overview', ed: null, el: null, busy: false, err: '', note: '', snap: null, review: null };

  function call(method, path, body) {
    return fetch(S.api + '/api/' + path, { method: method, headers: { Authorization: 'Bearer ' + S.key, 'Content-Type': 'text/plain;charset=utf-8' }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Server said ' + r.status }; }); })
      .catch(function () { return { ok: false, error: 'Could not reach the finance service. Check your connection.' }; });
  }
  function flash(msg, bad) { S.note = msg; S.noteBad = !!bad; var t = S.el && S.el.querySelector('.bf-note'); if (t) { t.textContent = msg; t.className = 'bf-note show' + (bad ? ' bad' : ''); clearTimeout(flash.t); flash.t = setTimeout(function () { t.className = 'bf-note'; }, 6000); } }
  function load() {
    return call('GET', 'job?job=' + encodeURIComponent(S.job.id)).then(function (d) {
      if (!d.ok) { S.err = d.error || 'Could not load'; S.data = null; draw(); return; }
      S.err = ''; S.data = d; draw();
    });
  }
  // One-time (safe to repeat) copy of what's already in the client's current software, so numbers carry on from there.
  function maybeImport() {
    var x = S.snap, d = S.data;
    if (!x || !x.f || !d || d.job.base.imported) return Promise.resolve();
    var f = x.f, num = n2;
    var codeOf = function (s) { return String(s || '').split(/[;,\n]/)[0].trim(); };
    var body = {
      job: S.job.id, name: S.job.name, base_contract: num(f['Total revised price']) - num(f['Change orders: approved Total price']),
      client: S.job.client ? { name: S.job.client, signers: [] } : undefined,
      budget: (x.codes || []).map(function (r) { return { code: r['Cost code'], category: r['Cost category'], name: r['Cost code'], original: num(r['Original budget costs']), actual_base: num(r['Actual costs']) }; }),
      pos: (x.pos || []).map(function (r) { var paid = String(r.Paid || '').toLowerCase() === 'paid'; var cost = num(r.Cost); return { number: r['PO #'], title: r.Title, vendor: r['Performed By'], status: r['PO Status'], cost: cost, paid_amount: paid ? cost : 0 }; }),
      cos: (x.cos || []).map(function (r) { return { number: r['CO ID#'], title: r.Title, status: r.Status, builder_cost: num(r['Builder cost']), price: num(r['Total price']) }; }),
      invoices: (x.inv || []).map(function (r) { return { number: r['Invoice ID'], title: r.Title, status: r.Status, total: num(r['Total price']), paid_amount: num(r['Amount paid']), due_date: String(r.Due || '').slice(0, 10), date_paid: String(r['Date paid'] || '').slice(0, 10), qb: r['QuickBooks invoice'] }; })
    };
    return call('POST', 'import', body).then(function (r) {
      if (!r.ok) { flash('Could not copy numbers from the current job software: ' + r.error, true); return; }
      flash('Copied this job’s purchase orders, change orders, invoices and budget from the current job software (' + r.added.pos + ' POs, ' + r.added.cos + ' COs, ' + r.added.invoices + ' invoices).');
      return load();
    });
  }

  // ---------- drawing
  function draw() {
    var el = S.el; if (!el) return;
    var d = S.data, h = '<div class="bf-note' + (S.note ? ' show' + (S.noteBad ? ' bad' : '') : '') + '">' + esc(S.note) + '</div>';
    h += '<div class="ch"><h2>Financial</h2><span class="dk-src" style="margin:0">Live in BuildFlowAI · numbers start from your current software</span></div>';
    if (S.err) { el.innerHTML = h + '<p class="dk-empty">' + esc(S.err) + '</p>'; return; }
    if (!d) { el.innerHTML = h + '<p class="dk-empty">Loading…</p>'; return; }
    var T = [['overview', 'Overview'], ['po', 'Purchase orders', d.rollup.pending.pos], ['co', 'Change orders', d.rollup.pending.cos], ['inv', 'Invoices', d.rollup.pending.invoices_draft]];
    h += '<div class="dk-tabs bf-tabs" role="tablist">' + T.map(function (t) { return '<button role="tab" data-bf-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + (t[2] ? ' <span class="n">' + t[2] + '</span>' : '') + '</button>'; }).join('') + '</div>';
    h += S.tab === 'overview' ? overview(d) : S.tab === 'po' ? poList(d) : S.tab === 'co' ? coList(d) : invList(d);
    el.innerHTML = h;
    if (S.ed) drawEditor();
  }
  function kpi(l, v, sub) { return '<div><small>' + esc(l) + '</small><b>' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
  function overview(d) {
    var r = d.rollup, p = r.price, b = r.billing, c = r.cost, att = [];
    d.pos.filter(function (x) { return x.status === 'draft'; }).forEach(function (x) { att.push(['po', x.id, x.number + ' ' + x.title, 'Purchase order waiting for approval']); });
    d.cos.filter(function (x) { return x.status === 'pending'; }).forEach(function (x) { var w = x.signers.filter(function (s) { return s.status === 'pending'; }).map(function (s) { return s.name; }).join(', '); att.push(['co', x.id, x.number + ' ' + x.title, 'Waiting on the client: ' + w]); });
    d.cos.filter(function (x) { return x.status === 'declined'; }).forEach(function (x) { att.push(['co', x.id, x.number + ' ' + x.title, 'Client declined']); });
    d.invoices.filter(function (x) { return x.display === 'Overdue'; }).forEach(function (x) { att.push(['inv', x.id, x.number + ' ' + x.title, 'Overdue, ' + money(x.totals.balance) + ' due ' + fdate(x.due_date)]); });
    d.invoices.filter(function (x) { return x.status === 'draft'; }).forEach(function (x) { att.push(['inv', x.id, x.number + ' ' + x.title, 'Draft invoice, not sent']); });
    var h = '<div class="big">' + kpi('Revised contract price', money(p.revised), 'Original ' + money(p.base) + ' + ' + money(p.co_approved) + ' approved changes') + kpi('Invoiced', money(b.invoiced), money(b.left_to_invoice) + ' left to invoice') + kpi('Paid by client', money(b.paid), money(b.balance) + ' still owed') + kpi('Projected profit', money(r.projected_profit)) + '</div>';
    h += '<div class="big">' + kpi('Revised budget', money(c.revised), 'Original ' + money(c.original) + ' + ' + money(c.co_cost) + ' changes') + kpi('Committed (approved POs)', money(c.committed)) + kpi('Actual costs', money(c.actual)) + kpi('Cost to complete', money(c.to_complete)) + '</div>';
    h += '<details class="fold sub" open><summary><h3>Needs attention · ' + att.length + '</h3></summary>' + (att.length ? '<ul class="al">' + att.map(function (a) { return '<li><div><b>' + esc(a[2]) + '</b><div class="dk-m">' + esc(a[3]) + '</div></div><button class="link" data-bf-open="' + a[0] + ':' + a[1] + '">Open →</button></li>'; }).join('') + '</ul>' : '<p class="dk-empty">Nothing waiting.</p>') + '</details>';
    h += '<details class="fold sub"><summary><h3>Budget by cost code</h3></summary>' + (r.budget.length ? '<div class="tw"><table class="bt"><thead><tr><th>Cost code</th><th class="r">Original</th><th class="r">Changes</th><th class="r">Revised</th><th class="r">Committed</th><th class="r">Actual</th><th class="r">To complete</th></tr></thead><tbody>' + r.budget.map(function (x) { return '<tr><td>' + esc(x.code) + '</td><td class="r">' + money(x.original) + '</td><td class="r">' + money(x.co) + '</td><td class="r">' + money(x.revised) + '</td><td class="r">' + money(x.committed) + '</td><td class="r">' + money(x.actual) + '</td><td class="r' + (x.to_complete < 0 ? ' bf-neg' : '') + '">' + money(x.to_complete) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="dk-empty">No budget yet.</p>') + '</details>';
    h += clientBox(d);
    return h;
  }
  function clientBox(d) {
    var c = d.job.client || {}, sg = c.signers || [];
    return '<details class="fold sub"><summary><h3>Who approves for the client' + (sg.length ? ' · ' + sg.length : ' · not set') + '</h3></summary><form class="bf-form" data-bf-client><p class="dk-m">Change orders go to these people to approve online. Invoices go to the first one.</p>' +
      [0, 1].map(function (i) { var s = sg[i] || {}; return '<div class="bf-row"><label>Name<input name="n' + i + '" value="' + esc(s.name || '') + '"></label><label>Email<input name="e' + i + '" type="email" value="' + esc(s.email || '') + '"></label></div>'; }).join('') +
      '<button class="bf-btn" type="submit">Save</button></form></details>';
  }
  function badge(s) { var k = String(s).toLowerCase().replace(/\s+/g, '-'); return '<span class="bf-st bf-' + esc(k) + '">' + esc(s) + '</span>'; }
  function table(cols, rows, kind, empty) {
    if (!rows.length) return '<p class="dk-empty">' + empty + '</p>';
    return '<div class="tw"><table class="bt bf-click"><thead><tr>' + cols.map(function (c) { return '<th' + (c[2] ? ' class="r"' : '') + '>' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr data-bf-open="' + kind + ':' + r.id + '" tabindex="0">' + cols.map(function (c) { var v = c[1](r); return '<td' + (c[2] ? ' class="r"' : '') + '>' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function poList(d) {
    return '<div class="bf-bar"><button class="bf-btn" data-bf-new="po">+ Purchase order</button><span class="dk-m">Approved POs count as committed costs.</span></div>' +
      table([['PO #', function (r) { return esc(r.number) + (r.imported ? ' <small class="bf-imp">BT</small>' : ''); }], ['Title', function (r) { return esc(r.title); }], ['Performed by', function (r) { return esc(r.vendor.name); }], ['Status', function (r) { return badge(r.display); }], ['Cost', function (r) { return money(r.totals.cost); }, 1], ['Paid', function (r) { return money(r.totals.paid); }, 1], ['Remaining', function (r) { return money(r.totals.remaining); }, 1]], d.pos, 'po', 'No purchase orders yet.');
  }
  function coList(d) {
    return '<div class="bf-bar"><button class="bf-btn" data-bf-new="co">+ Change order</button><span class="dk-m">Approved changes raise the contract price and the budget.</span></div>' +
      table([['CO #', function (r) { return esc(r.number) + (r.imported ? ' <small class="bf-imp">BT</small>' : ''); }], ['Title', function (r) { return esc(r.title); }], ['Status', function (r) { return badge(r.status === 'pending' ? 'Waiting on client' : r.status.charAt(0).toUpperCase() + r.status.slice(1)); }], ['Builder cost', function (r) { return money(r.totals.builder); }, 1], ['Total price', function (r) { return money(r.totals.price); }, 1], ['Changed', function (r) { return fdate((r.decided_at || r.sent_at || r.created_at || '').slice(0, 10)); }]], d.cos, 'co', 'No change orders yet.');
  }
  function invList(d) {
    return '<div class="bf-bar"><button class="bf-btn" data-bf-new="inv">+ Invoice</button><button class="bf-btn alt" data-bf-draws>Payment schedule</button><button class="bf-btn alt" data-bf-qb>QuickBooks export</button></div>' +
      table([['Invoice', function (r) { return esc(r.number) + (r.imported ? ' <small class="bf-imp">BT</small>' : ''); }], ['Title', function (r) { return esc(r.title); }], ['Status', function (r) { return badge(r.display); }], ['Total', function (r) { return money(r.totals.total); }, 1], ['Paid', function (r) { return money(r.totals.paid); }, 1], ['Balance due', function (r) { return money(r.totals.balance); }, 1], ['Viewed', function (r) { return r.viewed_at ? 'Yes' : ''; }], ['Due', function (r) { return fdate(r.due_date); }], ['QuickBooks', function (r) { return r.qb && r.qb.status === 'synced' ? 'Synced' : r.qb && r.qb.status === 'ready' ? 'Ready' : '—'; }]], d.invoices, 'inv', 'No invoices yet.');
  }

  // ---------- editor (one panel for all three, same grid as the current job software)
  function blankLine(kind) { return { desc: '', cost_type: '', cost_code: '', qty: 1, unit: '', unit_cost: '', markup_pct: kind === 'po' ? null : '' }; }
  function openEditor(kind, id) {
    var d = S.data, rec = id ? (kind === 'po' ? d.pos : kind === 'co' ? d.cos : d.invoices).filter(function (x) { return x.id === id; })[0] : null;
    var cs = (d.job.client && d.job.client.signers) || [];
    if (rec) S.ed = { kind: kind, rec: JSON.parse(JSON.stringify(rec)), isNew: false };
    else {
      var base = { lines: [blankLine(kind)], status: 'draft', events: [], bills: [], payments: [], title: '' };
      if (kind === 'po') Object.assign(base, { vendor: { name: '', email: '' }, scope: '', notes_internal: '', notes_vendor: '', variance: {}, due_date: '' });
      if (kind === 'co') Object.assign(base, { description: '', days_impact: 0, signers_planned: cs.map(function (s) { return { name: s.name, email: s.email }; }), approval_deadline: '', notes_internal: '' });
      if (kind === 'inv') Object.assign(base, { mode: 'lines', flat_amount: '', terms: S.cfg.settings.default_terms, invoice_date: ymd(new Date()), due_date: '', tax_pct: 0, retainage_pct: 0, notes_client: '', milestone: '', client: cs[0] ? { name: cs[0].name, email: cs[0].email } : { name: '', email: '' }, co_ids: [] });
      S.ed = { kind: kind, rec: base, isNew: true };
    }
    S.review = null; drawEditor();
  }
  function closeEditor() { S.ed = null; S.review = null; var m = S.el.querySelector('.bf-modal'); if (m) m.remove(); document.documentElement.classList.remove('bf-lock'); }
  function lineRow(l, i, kind, ro) {
    var cs = S.cfg.settings.cost_types, codes = (S.data.rollup.budget || []).map(function (b) { return b.code; });
    var inp = function (f, v, extra) { return '<input data-l="' + i + ':' + f + '" value="' + esc(v == null ? '' : v) + '" ' + (ro ? 'disabled' : '') + ' ' + (extra || '') + '>'; };
    var mk = kind !== 'po' ? '<td class="mk">' + inp('markup_pct', l.markup_pct == null ? '' : l.markup_pct, 'inputmode="decimal" placeholder="' + S.cfg.settings.default_markup_pct + '"') + '</td>' : '';
    return '<tr data-line="' + i + '"><td class="ds">' + inp('desc', l.desc, 'placeholder="Item"') + '</td><td><select data-l="' + i + ':cost_type" ' + (ro ? 'disabled' : '') + '><option value=""></option>' + cs.map(function (c) { return '<option' + (c === l.cost_type ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></td><td>' + inp('cost_code', l.cost_code, 'list="bf-codes"') + '</td><td class="q">' + inp('unit_cost', l.unit_cost, 'inputmode="decimal" placeholder="0.00"') + '</td><td class="q">' + inp('qty', l.qty, 'inputmode="decimal"') + '</td><td class="u">' + inp('unit', l.unit) + '</td>' + mk + '<td class="r bf-lt" data-lt="' + i + '"></td><td>' + (ro ? '' : '<button class="bf-x" type="button" data-bf-delline="' + i + '" title="Remove line">×</button>') + '</td></tr>' +
      (i === 0 && codes.length ? '' : '');
  }
  function calc(kind, rec) {
    var mk = S.cfg.settings.default_markup_pct, b = 0, p = 0, lt = [];
    (rec.lines || []).forEach(function (l) {
      var q = l.qty === '' || l.qty == null ? 1 : n2(l.qty), bc = r2(q * n2(l.unit_cost)), m = l.markup_pct === '' || l.markup_pct == null ? (kind === 'po' ? 0 : mk) : n2(l.markup_pct), pr = r2(bc * (1 + m / 100)); b += bc; p += pr; lt.push(kind === 'po' ? bc : pr);
    });
    return { builder: r2(b), price: r2(p), lt: lt };
  }
  function drawEditor() {
    var ed = S.ed; if (!ed) return; var k = ed.kind, r = ed.rec, d = S.data, can = S.cfg.can_approve;
    var locked = (k === 'po' && r.status === 'void') || (k === 'co' && r.status !== 'draft') || (k === 'inv' && r.status === 'void') || r.imported;
    var title = (k === 'po' ? 'Purchase order' : k === 'co' ? 'Change order' : 'Invoice') + (r.number ? ' ' + r.number : ' (new)');
    var stat = k === 'po' ? r.display || 'Draft' : k === 'co' ? ({ draft: 'Draft', pending: 'Waiting on client', approved: 'Approved', declined: 'Declined', void: 'Void' }[r.status]) : r.display || 'Draft';
    var h = '<div class="bf-head"><div><b>' + esc(title) + '</b> ' + badge(stat) + (r.imported ? ' <small class="bf-imp">from your current software</small>' : '') + '</div><button class="bf-x big" data-bf-close aria-label="Close">×</button></div><div class="bf-body">';
    if (r.imported) h += '<p class="bf-warn">This came from your current software. Totals and status are copied; line detail was not available. It is read-only here.</p>';
    if (k === 'po' && r.approved_by) h += '<p class="dk-m">Approved by ' + esc(r.approved_by) + ' on ' + fdate((r.approved_at || '').slice(0, 10)) + '</p>';
    h += '<form class="bf-form" data-bf-form autocomplete="off"><fieldset ' + (locked ? 'disabled' : '') + '>';
    h += '<label>Title<input data-f="title" value="' + esc(r.title) + '"></label>';
    if (k === 'po') h += '<div class="bf-row"><label>Assigned to (who is doing the work)<input data-f="vendor.name" value="' + esc(r.vendor.name) + '"></label><label>Their email<input data-f="vendor.email" type="email" value="' + esc(r.vendor.email) + '"></label></div><div class="bf-row"><label>Scheduled completion<input data-f="due_date" type="date" value="' + esc(r.due_date) + '"></label><label class="bf-chk"><input data-f="materials_only" type="checkbox" ' + (r.materials_only ? 'checked' : '') + '> Materials only</label><label class="bf-chk"><input data-f="variance.is" type="checkbox" ' + (r.variance && r.variance.is ? 'checked' : '') + '> Variance PO</label></div><label>Scope of work<textarea data-f="scope" rows="3">' + esc(r.scope) + '</textarea></label>';
    if (k === 'co') h += '<label>Description for the client<textarea data-f="description" rows="3">' + esc(r.description) + '</textarea></label><div class="bf-row"><label>Days added to schedule<input data-f="days_impact" inputmode="numeric" value="' + esc(r.days_impact || 0) + '"></label><label>Respond by<input data-f="approval_deadline" type="date" value="' + esc(r.approval_deadline) + '"></label></div>';
    if (k === 'inv') {
      var draws = (d.job.draws || []).filter(function (x) { return !x.invoice_id || x.invoice_id === r.id; });
      h += '<div class="bf-row"><label>Bill to<input data-f="client.name" value="' + esc(r.client.name) + '"></label><label>Their email<input data-f="client.email" type="email" value="' + esc(r.client.email) + '"></label></div>' +
        '<div class="bf-row"><label>Invoice date<input data-f="invoice_date" type="date" value="' + esc(r.invoice_date) + '"></label><label>Payment terms<select data-f="terms">' + S.cfg.settings.payment_terms.map(function (t) { return '<option' + (t === r.terms ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label><label>Due<input data-f="due_date" type="date" value="' + esc(r.due_date) + '"></label></div>' +
        '<div class="bf-row"><label>Milestone / draw<input data-f="milestone" value="' + esc(r.milestone) + '" list="bf-draws"></label><label>Build it as<select data-f="mode"><option value="lines"' + (r.mode === 'lines' ? ' selected' : '') + '>Line items</option><option value="flat"' + (r.mode === 'flat' ? ' selected' : '') + '>Flat fee</option></select></label></div><datalist id="bf-draws">' + draws.map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('') + '</datalist>';
    }
    var flat = k === 'inv' && r.mode === 'flat';
    if (flat) h += '<label>Amount<input data-f="flat_amount" inputmode="decimal" value="' + esc(r.flat_amount) + '"></label>';
    else h += '<div class="tw"><table class="bf-lines"><thead><tr><th>Item</th><th>Cost type</th><th>Cost code</th><th class="q">Unit cost</th><th class="q">Qty</th><th class="u">Unit</th>' + (k !== 'po' ? '<th class="mk">Markup %</th>' : '') + '<th class="r">' + (k === 'po' ? 'Total' : 'Client price') + '</th><th></th></tr></thead><tbody>' + (r.lines || []).map(function (l, i) { return lineRow(l, i, k, locked); }).join('') + '</tbody></table></div>' + (locked ? '' : '<div class="bf-bar"><button type="button" class="bf-btn alt" data-bf-addline>+ Add line</button>' + (k === 'inv' ? '<button type="button" class="bf-btn alt" data-bf-addco>+ Add approved change order</button>' : '') + '</div>') + '<datalist id="bf-codes">' + (d.rollup.budget || []).map(function (b) { return '<option value="' + esc(b.code) + '">'; }).join('') + '</datalist>';
    h += '<div class="bf-tot" data-tot></div>';
    if (k === 'inv') h += '<div class="bf-row"><label>Tax %<input data-f="tax_pct" inputmode="decimal" value="' + esc(r.tax_pct) + '"></label><label>Retainage %<input data-f="retainage_pct" inputmode="decimal" value="' + esc(r.retainage_pct) + '"></label></div><label>Note to the client<textarea data-f="notes_client" rows="2">' + esc(r.notes_client) + '</textarea></label>';
    if (k === 'co') h += '<h4>Who approves</h4>' + ((r.status === 'draft' ? r.signers_planned : r.signers) || []).map(function (s, i) { return '<div class="bf-row"><label>Name<input data-sg="' + i + ':name" value="' + esc(s.name) + '" ' + (r.status === 'draft' ? '' : 'disabled') + '></label><label>Email<input data-sg="' + i + ':email" value="' + esc(s.email) + '" ' + (r.status === 'draft' ? '' : 'disabled') + '></label>' + (r.status !== 'draft' ? '<span class="bf-sgst">' + badge(s.status === 'approved' ? 'Approved' : s.status === 'declined' ? 'Declined' : 'Waiting') + (s.signed_at ? '<small>' + esc(s.signed_name || '') + ' · ' + ftime(s.signed_at) + '</small>' : '') + '</span>' : '') + '</div>'; }).join('') + (r.status === 'draft' ? '<button type="button" class="bf-btn alt" data-bf-addsg>+ Add approver</button>' : '') + (r.manual ? '<p class="dk-m">Approved manually by ' + esc(r.manual.by) + ': ' + esc(r.manual.note) + '</p>' : '');
    if (k === 'po') h += '<div class="bf-row"><label>Internal notes (never shown to the vendor)<textarea data-f="notes_internal" rows="2">' + esc(r.notes_internal) + '</textarea></label><label>Notes to the vendor<textarea data-f="notes_vendor" rows="2">' + esc(r.notes_vendor) + '</textarea></label></div>';
    else h += '<label>Internal notes (never shown to the client)<textarea data-f="notes_internal" rows="2">' + esc(r.notes_internal) + '</textarea></label>';
    h += '</fieldset></form>';
    // bills / payments
    if (k === 'po' && r.status === 'approved') h += '<h4>Bills</h4>' + payTable(r.bills, 'bill_delete', 'bill_id') + (r.totals.remaining > 0.004 ? '<form class="bf-form bf-inline" data-bf-pay="bill"><input name="amount" inputmode="decimal" placeholder="Amount" required><input name="date" type="date" value="' + ymd(new Date()) + '"><input name="method" placeholder="Method (check, ACH, card)"><input name="ref" placeholder="Bill / ref #"><button class="bf-btn" type="submit">Record bill</button></form>' : '');
    if (k === 'inv' && r.status !== 'draft' && r.status !== 'void') h += '<h4>Payments</h4>' + payTable(r.payments, 'payment_delete', 'payment_id') + (r.totals.balance > 0.004 ? '<form class="bf-form bf-inline" data-bf-pay="payment"><input name="amount" inputmode="decimal" placeholder="Amount" value="' + r.totals.balance + '" required><input name="date" type="date" value="' + ymd(new Date()) + '"><input name="method" placeholder="Method" value="Check"><input name="ref" placeholder="Check # / ref"><button class="bf-btn" type="submit">Record payment</button></form>' : '');
    if (k === 'inv' && r.qb) h += '<p class="dk-m">QuickBooks: ' + (r.qb.status === 'synced' ? 'synced' + (r.qb.qbo_id ? ' (#' + esc(r.qb.qbo_id) + ')' : '') : r.qb.status === 'ready' ? 'ready to sync later (not connected yet)' : 'not ready until sent') + '</p>';
    if (S.review) h += reviewBox();
    h += '<details class="fold sub"><summary><h3>History</h3></summary><ul class="bf-hist">' + (r.events || []).slice().reverse().map(function (e) { return '<li><time>' + ftime(e.at) + '</time> <b>' + esc(e.who) + '</b> ' + esc(e.what) + '</li>'; }).join('') + '</ul></details>';
    h += '</div><div class="bf-foot">' + actions(k, r, locked, can) + '</div>';
    var m = S.el.querySelector('.bf-modal');
    if (!m) { m = document.createElement('div'); m.className = 'bf-modal'; S.el.appendChild(m); document.documentElement.classList.add('bf-lock'); }
    var keep = m.querySelector('.bf-body'), st = keep ? keep.scrollTop : 0;
    m.innerHTML = '<div class="bf-panel" role="dialog" aria-modal="true">' + h + '</div>';
    var nb = m.querySelector('.bf-body'); if (nb) nb.scrollTop = st;
    refreshTotals();
  }
  function payTable(rows, act, idf) {
    if (!rows || !rows.length) return '<p class="dk-empty">None recorded yet.</p>';
    return '<div class="tw"><table class="bt"><thead><tr><th>Date</th><th>Method</th><th>Ref</th><th class="r">Amount</th><th></th></tr></thead><tbody>' + rows.map(function (p) { return '<tr><td>' + fdate(p.date) + '</td><td>' + esc(p.method) + '</td><td>' + esc(p.ref) + '</td><td class="r">' + money(p.amount) + '</td><td>' + (S.ed.rec.imported ? '' : '<button class="bf-x" data-bf-act="' + act + '" data-idf="' + idf + '" data-idv="' + p.id + '" title="Remove">×</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function actions(k, r, locked, can) {
    var b = function (a, label, cls) { return '<button class="bf-btn ' + (cls || '') + '" type="button" data-bf-act="' + a + '">' + label + '</button>'; };
    var h = '';
    if (r.imported) return b('close', 'Close', 'alt');
    if (k === 'po') {
      if (r.status === 'draft') h += b('save', 'Save') + (can && !S.ed.isNew ? b('approve', 'Approve') : '') + (!S.ed.isNew ? b('del', 'Delete', 'alt') : '');
      if (r.status === 'approved') h += b('save', 'Save (needs re-approval)', 'alt') + b('send', 'Send to vendor') + b('void', 'Void', 'alt');
      if (r.status === 'void') h += '<span class="dk-m">Void: counts nowhere.</span>';
    }
    if (k === 'co') {
      if (r.status === 'draft') h += b('save', 'Save') + b('send', 'Send to client for approval') + (!S.ed.isNew ? (can ? b('manual', 'Approve for client…', 'alt') : '') + b('del', 'Delete', 'alt') : '');
      if (r.status === 'pending') h += b('recall', 'Recall to draft', 'alt') + (can ? b('manual', 'Approve for client…', 'alt') : '') + b('void', 'Void', 'alt');
      if (r.status === 'approved') h += b('void', 'Void (removes it from price and budget)', 'alt');
      if (r.status === 'declined') h += b('void', 'Void', 'alt');
    }
    if (k === 'inv') {
      if (r.status === 'draft') h += b('save', 'Save') + b('send', 'Send to client') + (!S.ed.isNew ? b('del', 'Delete', 'alt') : '');
      else if (r.status !== 'void') h += b('save', 'Save', 'alt') + b('send', 'Resend', 'alt') + (r.payments && r.payments.length ? '' : b('void', 'Void', 'alt'));
    }
    return h + b('close', 'Close', 'alt');
  }
  function reviewBox() {
    var v = S.review;
    return '<div class="bf-review"><h4>Review before it goes out</h4><dl class="mt"><dt>To</dt><dd>' + v.to.map(esc).join(', ') + '</dd><dt>Subject</dt><dd>' + esc(v.subject) + '</dd><dt>Message</dt><dd style="white-space:pre-wrap">' + esc(v.body) + '</dd></dl>' +
      (S.cfg.settings.mail_mode !== 'live' ? '<p class="bf-warn">Test mode: nothing is emailed to the real recipient. The message goes only to Michael, and you get the link below to try the client page yourself.</p>' : '') +
      '<div class="bf-bar"><button class="bf-btn" type="button" data-bf-act="confirm-' + v.action + '">Yes, send it</button><button class="bf-btn alt" type="button" data-bf-act="cancel-review">Cancel</button></div></div>';
  }
  function refreshTotals() {
    var m = S.el.querySelector('.bf-modal'); if (!m || !S.ed) return;
    var k = S.ed.kind, r = S.ed.rec, c = calc(k, r), t = m.querySelector('[data-tot]'); if (!t) return;
    c.lt.forEach(function (v, i) { var e = m.querySelector('[data-lt="' + i + '"]'); if (e) e.textContent = money(v); });
    if (k === 'po') t.innerHTML = '<div><small>PO total</small><b>' + money(c.builder) + '</b></div>' + (r.totals ? '<div><small>Paid</small><b>' + money(r.totals.paid) + '</b></div><div><small>Remaining</small><b>' + money(r.totals.remaining) + '</b></div>' : '');
    if (k === 'co') t.innerHTML = '<div><small>Builder cost</small><b>' + money(c.builder) + '</b></div><div><small>Markup</small><b>' + money(c.price - c.builder) + '</b></div><div><small>Total price to client</small><b>' + money(c.price) + '</b></div>';
    if (k === 'inv') { var sub = r.mode === 'flat' ? n2(r.flat_amount) : c.price, tax = r2(sub * n2(r.tax_pct) / 100), ret = r2(sub * n2(r.retainage_pct) / 100), paid = r.totals ? r.totals.paid : 0; t.innerHTML = '<div><small>Subtotal</small><b>' + money(sub) + '</b></div>' + (tax ? '<div><small>Tax</small><b>' + money(tax) + '</b></div>' : '') + (ret ? '<div><small>Retainage held</small><b>−' + money(ret) + '</b></div>' : '') + '<div><small>Total</small><b>' + money(sub + tax - ret) + '</b></div><div><small>Balance due</small><b>' + money(sub + tax - ret - paid) + '</b></div>'; }
  }
  function setPath(o, path, v) { var p = path.split('.'); for (var i = 0; i < p.length - 1; i++) { o[p[i]] = o[p[i]] || {}; o = o[p[i]]; } o[p[p.length - 1]] = v; }
  function syncField(t) {
    var ed = S.ed; if (!ed) return;
    if (t.dataset.f) setPath(ed.rec, t.dataset.f, t.type === 'checkbox' ? t.checked : t.value);
    else if (t.dataset.l) { var p = t.dataset.l.split(':'); ed.rec.lines[+p[0]][p[1]] = t.value; }
    else if (t.dataset.sg) { var q = t.dataset.sg.split(':'); ed.rec.signers_planned[+q[0]][q[1]] = t.value; }
  }
  function payload() {
    var ed = S.ed, r = ed.rec, b = { job: S.job.id, id: ed.isNew ? undefined : r.id, title: r.title, lines: r.lines, notes_internal: r.notes_internal };
    if (ed.kind === 'po') Object.assign(b, { vendor: r.vendor, materials_only: r.materials_only, due_date: r.due_date, scope: r.scope, variance: r.variance, notes_vendor: r.notes_vendor });
    if (ed.kind === 'co') Object.assign(b, { description: r.description, days_impact: r.days_impact, approval_deadline: r.approval_deadline, signers: (r.signers_planned || []).filter(function (s) { return s.name || s.email; }) });
    if (ed.kind === 'inv') Object.assign(b, { mode: r.mode, flat_amount: r.flat_amount, invoice_date: r.invoice_date, terms: r.terms, due_date: r.due_date, milestone: r.milestone, tax_pct: r.tax_pct, retainage_pct: r.retainage_pct, notes_client: r.notes_client, client: r.client, co_ids: r.co_ids, draw_id: r.draw_id });
    return b;
  }
  function save() {
    var ed = S.ed, ep = { po: 'po/save', co: 'co/save', inv: 'inv/save' }[ed.kind];
    return call('POST', ep, payload()).then(function (r) {
      if (!r.ok) { flash(r.error, true); return null; }
      var rec = r.po || r.co || r.invoice; S.ed = { kind: ed.kind, rec: rec, isNew: false }; flash('Saved ' + rec.number + '.'); return load().then(function () { return rec; });
    });
  }
  function actCall(kind, a, extra) {
    var ep = { po: 'po/act', co: 'co/act', inv: 'inv/act' }[kind], r = S.ed.rec;
    return call('POST', ep, Object.assign({ job: S.job.id, id: r.id, action: a }, extra || {})).then(function (res) {
      if (!res.ok) { flash(res.error, true); return null; }
      return res;
    });
  }
  function afterAct(res, msg) {
    var rec = res.po || res.co || res.invoice; if (res.deleted) { closeEditor(); flash(msg || 'Deleted.'); return load(); }
    S.ed = { kind: S.ed.kind, rec: rec, isNew: false }; S.review = null;
    var m = msg || 'Done.'; if (res.link) m += ' Link for the ' + (S.ed.kind === 'po' ? 'vendor' : 'client') + ': ' + res.link; if (res.links) m += ' Links: ' + res.links.map(function (l) { return l.name + ': ' + l.link; }).join(' · ');
    S.lastLinks = res.links || (res.link ? [{ name: '', link: res.link }] : null);
    flash(m); return load();
  }
  function startSend(kind) {
    var r = S.ed.rec, to, subj, body;
    if (kind === 'po') { to = [r.vendor.email || '(no email on file)']; subj = 'Purchase order ' + r.number + ' from ' + S.cfg.settings.company; body = 'PO ' + r.number + ': ' + r.title + '\nTotal ' + money(r.totals.cost) + '\nA link to view the PO.'; }
    if (kind === 'co') { to = (r.signers_planned || []).map(function (s) { return s.name + ' <' + s.email + '>'; }); subj = 'Change order ' + r.number + ' for your approval'; body = r.title + '\nPrice ' + money(r.totals ? r.totals.price : calc('co', r).price) + (n2(r.days_impact) ? ', adds ' + n2(r.days_impact) + ' day(s)' : '') + '\nA link to review and approve online. They never see your cost or markup.'; }
    if (kind === 'inv') { to = [(r.client.name || '') + ' <' + r.client.email + '>']; subj = 'Invoice ' + r.number + ' from ' + S.cfg.settings.company; body = r.title + '\nBalance due ' + money(r.totals ? r.totals.balance : 0) + ' by ' + fdate(r.due_date) + '\nA link to view the invoice.'; }
    S.review = { action: 'send', to: to, subject: subj, body: body }; drawEditor();
  }

  // ---------- events
  function onClick(e) {
    var t = e.target, b;
    if ((b = t.closest('[data-bf-tab]'))) { S.tab = b.dataset.bfTab; draw(); return; }
    if ((b = t.closest('[data-bf-new]'))) { openEditor(b.dataset.bfNew); return; }
    if ((b = t.closest('[data-bf-open]'))) { var p = b.dataset.bfOpen.split(':'); S.tab = p[0]; openEditor(p[0], p[1]); return; }
    if (t.closest('[data-bf-close]')) { closeEditor(); return; }
    if (t.closest('[data-bf-draws]')) { openDraws(); return; }
    if (t.closest('[data-bf-qb]')) { call('GET', 'qb-export?job=' + encodeURIComponent(S.job.id)).then(function (r) { openText('QuickBooks-ready invoices', r.ok ? JSON.stringify(r.invoices, null, 2) : r.error, 'Not sent to QuickBooks. This is the shape a later sync will use. ' + r.invoices.length + ' invoice(s).'); }); return; }
    if (!S.ed) return;
    if (t.closest('[data-bf-addline]')) { S.ed.rec.lines.push(blankLine(S.ed.kind)); drawEditor(); return; }
    if (t.closest('[data-bf-addsg]')) { (S.ed.rec.signers_planned = S.ed.rec.signers_planned || []).push({ name: '', email: '' }); drawEditor(); return; }
    if ((b = t.closest('[data-bf-delline]'))) { S.ed.rec.lines.splice(+b.dataset.bfDelline, 1); if (!S.ed.rec.lines.length) S.ed.rec.lines.push(blankLine(S.ed.kind)); drawEditor(); return; }
    if (t.closest('[data-bf-addco]')) {
      var cos = S.data.cos.filter(function (c) { return c.status === 'approved' && !c.imported && (S.ed.rec.co_ids || []).indexOf(c.id) < 0; });
      if (!cos.length) { flash('No approved change orders left to add.', true); return; }
      cos.forEach(function (c) { S.ed.rec.co_ids = (S.ed.rec.co_ids || []).concat(c.id); S.ed.rec.lines.push({ desc: c.number + ' ' + c.title, cost_type: '', cost_code: '', qty: 1, unit: '', unit_cost: c.totals.price, markup_pct: 0 }); });
      S.ed.rec.lines = S.ed.rec.lines.filter(function (l) { return l.desc || n2(l.unit_cost); }); drawEditor(); flash('Added ' + cos.length + ' approved change order(s) at their client price.'); return;
    }
    if ((b = t.closest('[data-bf-act]'))) { doAct(b.dataset.bfAct, b); return; }
  }
  function doAct(a, btn) {
    var ed = S.ed, k = ed.kind, r = ed.rec;
    if (a === 'close') return closeEditor();
    if (a === 'cancel-review') { S.review = null; return drawEditor(); }
    if (a === 'save') return save();
    if (a === 'bill_delete' || a === 'payment_delete') { var x = {}; x[btn.dataset.idf] = btn.dataset.idv; return actCall(k, a, x).then(function (res) { if (res) afterAct(res, 'Removed.'); }); }
    if (a === 'send') { return save().then(function (rec) { if (rec) startSend(k); }); }
    if (a === 'confirm-send') return actCall(k, 'send').then(function (res) { if (res) afterAct(res, res.mail && res.mail.delivered ? 'Sent' + (res.mail.mode !== 'live' ? ' in test mode: the email went only to Michael, not the real recipient.' : '.') : 'Link ready. The email service is not connected yet, so nothing was emailed. Copy the link below to send it yourself.'); });
    if (a === 'approve') return save().then(function (rec) { if (rec) actCall('po', 'approve').then(function (res) { if (res) afterAct(res, 'Approved. It now counts as a committed cost.'); }); });
    if (a === 'void') { if (!confirm('Void this ' + (k === 'po' ? 'purchase order' : k === 'co' ? 'change order' : 'invoice') + '? It stops counting everywhere.')) return; return actCall(k, 'void').then(function (res) { if (res) afterAct(res, 'Voided.'); }); }
    if (a === 'recall') return actCall(k, 'recall').then(function (res) { if (res) afterAct(res, 'Recalled. You can edit it again.'); });
    if (a === 'del') { if (!confirm('Delete this draft?')) return; return actCall(k, 'delete').then(function (res) { if (res) afterAct(res, 'Deleted.'); }); }
    if (a === 'manual') { var note = prompt('How did the client approve? (for example: signed paper copy, or email on Nov 22)'); if (!note) return; return actCall('co', 'manual_approve', { note: note }).then(function (res) { if (res) afterAct(res, 'Approved for the client. Price and budget updated.'); }); }
  }
  function onSubmit(e) {
    var f = e.target;
    if (f.hasAttribute('data-bf-client')) {
      e.preventDefault(); var sg = [0, 1].map(function (i) { return { name: f['n' + i].value.trim(), email: f['e' + i].value.trim() }; }).filter(function (s) { return s.name || s.email; });
      call('POST', 'job/setup', { job: S.job.id, client: { name: sg[0] ? sg[0].name : '', email: sg[0] ? sg[0].email : '', signers: sg } }).then(function (r) { if (!r.ok) return flash(r.error, true); flash('Saved.'); load(); }); return;
    }
    if (f.hasAttribute('data-bf-pay')) {
      e.preventDefault(); var kind = f.getAttribute('data-bf-pay'), body = { amount: f.amount.value, date: f.date.value, method: f.method.value, ref: f.ref.value };
      actCall(S.ed.kind, kind, body).then(function (res) { if (res) afterAct(res, (kind === 'bill' ? 'Bill' : 'Payment') + ' recorded.'); }); return;
    }
    if (f.hasAttribute('data-bf-form')) e.preventDefault();
  }
  function openText(title, text, note) {
    var m = document.createElement('div'); m.className = 'bf-modal'; document.documentElement.classList.add('bf-lock');
    m.innerHTML = '<div class="bf-panel"><div class="bf-head"><b>' + esc(title) + '</b><button class="bf-x big" data-bf-close2>×</button></div><div class="bf-body"><p class="dk-m">' + esc(note) + '</p><pre class="bf-pre">' + esc(text) + '</pre></div></div>';
    m.addEventListener('click', function (e) { if (e.target.closest('[data-bf-close2]')) { m.remove(); document.documentElement.classList.remove('bf-lock'); } }); S.el.appendChild(m);
  }
  function openDraws() {
    var d = S.data, draws = (d.job.draws || []).map(function (x) { return Object.assign({}, x); });
    var m = document.createElement('div'); m.className = 'bf-modal'; document.documentElement.classList.add('bf-lock');
    function paint() {
      var rev = d.rollup.price.revised;
      m.innerHTML = '<div class="bf-panel"><div class="bf-head"><b>Payment schedule</b><button class="bf-x big" data-x>×</button></div><div class="bf-body"><p class="dk-m">Draws billed at milestones, like the current job software’s payment schedule. Percent is of the revised contract price (' + money(rev) + '). “Make invoice” creates a draft you can review.</p><div class="tw"><table class="bf-lines"><thead><tr><th>Draw</th><th>Milestone</th><th class="q">%</th><th class="q">Amount</th><th>Invoice</th><th></th></tr></thead><tbody>' +
        draws.map(function (x, i) { var amt = x.amount != null && x.amount !== '' ? n2(x.amount) : r2(rev * n2(x.pct) / 100); var inv = x.invoice_id && d.invoices.filter(function (v) { return v.id === x.invoice_id; })[0]; return '<tr><td><input data-d="' + i + ':name" value="' + esc(x.name) + '"></td><td><input data-d="' + i + ':milestone" value="' + esc(x.milestone) + '"></td><td class="q"><input data-d="' + i + ':pct" value="' + esc(x.pct == null ? '' : x.pct) + '"></td><td class="q"><input data-d="' + i + ':amount" value="' + esc(x.amount == null ? '' : x.amount) + '" placeholder="' + amt + '"></td><td>' + (inv ? esc(inv.number) + ' ' + badge(inv.display) : (x.id && !x.id.startsWith('new') ? '<button class="bf-btn alt" data-mk="' + i + '">Make invoice</button>' : '<small>Save first</small>')) + '</td><td><button class="bf-x" data-rm="' + i + '">×</button></td></tr>'; }).join('') + '</tbody></table></div><div class="bf-bar"><button class="bf-btn alt" data-add>+ Add draw</button><button class="bf-btn" data-save>Save schedule</button></div></div></div>';
    }
    paint();
    m.addEventListener('input', function (e) { var t = e.target; if (t.dataset.d) { var p = t.dataset.d.split(':'); draws[+p[0]][p[1]] = t.value; } });
    m.addEventListener('click', function (e) {
      var t = e.target, b;
      if (t.closest('[data-x]')) { m.remove(); document.documentElement.classList.remove('bf-lock'); return; }
      if (t.closest('[data-add]')) { draws.push({ id: 'new' + Date.now(), name: 'Draw ' + (draws.length + 1), milestone: '', pct: '', amount: '' }); paint(); return; }
      if ((b = t.closest('[data-rm]'))) { draws.splice(+b.dataset.rm, 1); paint(); return; }
      if (t.closest('[data-save]')) { call('POST', 'draw/save', { job: S.job.id, draws: draws.map(function (x) { return Object.assign({}, x, { id: String(x.id).startsWith('new') ? '' : x.id }); }) }).then(function (r) { if (!r.ok) return flash(r.error, true); flash('Payment schedule saved.'); m.remove(); document.documentElement.classList.remove('bf-lock'); load().then(openDraws); }); return; }
      if ((b = t.closest('[data-mk]'))) {
        var x = draws[+b.dataset.mk], rev = d.rollup.price.revised, amt = x.amount != null && x.amount !== '' ? n2(x.amount) : r2(rev * n2(x.pct) / 100);
        if (!(amt > 0)) return flash('Set a percent or amount first.', true);
        var cs = (d.job.client && d.job.client.signers && d.job.client.signers[0]) || {};
        call('POST', 'inv/save', { job: S.job.id, title: x.name + (x.milestone ? ' · ' + x.milestone : ''), mode: 'flat', flat_amount: amt, milestone: x.milestone, draw_id: x.id, client: cs }).then(function (r) {
          if (!r.ok) return flash(r.error, true); x.invoice_id = r.invoice.id;
          call('POST', 'draw/save', { job: S.job.id, draws: draws }).then(function () { flash('Draft invoice ' + r.invoice.number + ' created. Review it, then send.'); m.remove(); document.documentElement.classList.remove('bf-lock'); S.tab = 'inv'; load().then(function () { openEditor('inv', r.invoice.id); }); });
        });
      }
    });
    S.el.appendChild(m);
  }

  var bound = new WeakSet();
  function bind(el) {
    if (bound.has(el)) return; bound.add(el);
    el.addEventListener('click', onClick); el.addEventListener('submit', onSubmit);
    el.addEventListener('input', function (e) { if (!S.ed || !e.target.closest('.bf-modal')) return; syncField(e.target); if (e.target.dataset.f === 'mode') drawEditor(); else refreshTotals(); });
    el.addEventListener('change', function (e) { if (!S.ed || !e.target.closest('.bf-modal')) return; syncField(e.target); if (e.target.dataset.f === 'mode') drawEditor(); else refreshTotals(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.ed) closeEditor(); if (e.key === 'Enter' && e.target.matches('tr[data-bf-open]')) e.target.click(); });
  }

  window.BFFinance = {
    // opts: { api, key, job:{id,name,client}, snap:{f,pos,cos,inv,budget} }
    mount: function (el, opts) {
      var sameJob = !!(S.job && S.job.id === opts.job.id);
      S.api = String(opts.api || '').replace(/\/$/, ''); S.key = opts.key; S.job = opts.job; S.snap = opts.snap || null; S.el = el; bind(el);
      if (sameJob && S.data) { draw(); return; }
      if (!sameJob) { S.tab = 'overview'; S.ed = null; S.data = null; S.note = ''; }
      draw();
      var jobId = S.job.id;
      (S.cfg ? Promise.resolve() : call('GET', 'config').then(function (c) { if (!c.ok) { S.err = c.error === 'not signed in' ? 'The finance tools are not turned on for this link yet.' : c.error; return; } S.cfg = c; }))
        .then(function () { if (S.err || S.job.id !== jobId) return; return load(); })
        .then(function () { if (S.data && S.job.id === jobId) return maybeImport(); });
    }
  };
})();
