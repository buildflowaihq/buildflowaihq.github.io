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
      S.err = ''; S.data = d;
      return Promise.all([call('GET', 'vendors'), call('GET', 'payments?job=' + encodeURIComponent(S.job.id))]).then(function (a) { S.vendors = a[0].ok ? a[0].vendors : []; S.pays = a[1].ok ? a[1] : null; draw(); });
    });
  }
  // One-time (safe to repeat) copy of what's already in the client's current software, so numbers carry on from there.
  function btIso(v) { var d = new Date(String(v || '').replace(/,\s*\d+:\d+.*$/, '')); return isNaN(d) ? '' : d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
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
      invoices: (x.inv || []).map(function (r) { return { number: r['Invoice ID'], title: r.Title, status: r.Status, total: num(r['Total price']), paid_amount: num(r['Amount paid']), due_date: String(r.Due || '').slice(0, 10), date_paid: String(r['Date paid'] || '').slice(0, 10), qb: r['QuickBooks invoice'] }; }),
      bills: (x.bills || []).map(function (r) { return { number: r['Bill #'], title: r['Bill title'], vendor: r['Pay to'], status: r['Bill status'], amount: num(r['Bill amount']), paid_amount: num(r['Amount paid']), bill_date: btIso(r['Invoice date']), due_date: btIso(r['Due date']), date_paid: btIso(r['Date paid']) }; })
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
    var keepM = [].slice.call(el.querySelectorAll('.bf-modal:not([data-editor])'));
    keepM.forEach(function (m) { m.remove(); });
    var d = S.data, h = '<div class="bf-note' + (S.note ? ' show' + (S.noteBad ? ' bad' : '') : '') + '">' + esc(S.note) + '</div>';
    h += '<div class="ch"><h2>Financial</h2><span class="dk-src" style="margin:0">Live in BuildFlowAI · numbers start from your current software</span></div>';
    if (S.err) { el.innerHTML = h + '<p class="dk-empty">' + esc(S.err) + '</p>'; return; }
    if (!d) { el.innerHTML = h + '<p class="dk-empty">Loading…</p>'; return; }
    var T = [['overview', 'Overview'], ['est', 'Estimate'], ['jcb', 'Job costing budget'], ['po', 'Purchase orders', d.rollup.pending.pos], ['co', 'Change orders', d.rollup.pending.cos], ['inv', 'Invoices', d.rollup.pending.invoices_draft], ['bills', 'Bills', (d.rollup.pending.bills || 0)], ['pay', 'Payments'], ['cm', 'Credit memos'], ['dep', 'Deposits', (d.rollup.billing.deposits_held > 0 ? 1 : 0)], ['rfi', 'RFIs', (d.rollup.pending.rfis || 0)], ['vendors', 'Vendors']];
    if (!S.single) h += '<div class="dk-tabs bf-tabs" role="tablist">' + T.map(function (t) { return '<button role="tab" data-bf-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + (t[2] ? ' <span class="n">' + t[2] + '</span>' : '') + '</button>'; }).join('') + '</div>';
    h += '<div class="bf-quick" aria-label="Quick actions"><button class="bf-btn" data-bf-new="co">+ Change order</button><button class="bf-btn" data-bf-new="po">+ PO</button><button class="bf-btn" data-bf-new="inv">+ Invoice</button><button class="bf-btn alt" data-bf-bnew>+ Bill / receipt</button></div>';
    h += S.tab === 'overview' ? overview(d) : S.tab === 'est' ? estTab(d) : S.tab === 'jcb' ? jcbTab(d) : S.tab === 'po' ? poList(d) : S.tab === 'co' ? coList(d) : S.tab === 'vendors' ? vendorTab() : S.tab === 'bills' ? billList(d) : S.tab === 'pay' ? payTab() : S.tab === 'cm' ? cmTab(d) : S.tab === 'dep' ? depTab(d) : S.tab === 'rfi' ? rfiTab(d) : invList(d);
    el.innerHTML = h;
    keepM.forEach(function (m) { el.appendChild(m); });
    if (S.ed) drawEditor();
  }
  function kpi(l, v, sub) { return '<div><small>' + esc(l) + '</small><b>' + v + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }
  function proposalsView(pr) { return '<details class="fold sub"><summary><h3>Proposals · ' + pr.length + '</h3></summary><div class="tw"><table class="bt"><thead><tr><th>Proposal</th><th>Status</th><th>Last updated</th><th class="r">Total price</th><th>Client viewed</th></tr></thead><tbody>' + pr.map(function (x) { return '<tr><td>' + esc(x.title) + '</td><td>' + badge(x.status) + '</td><td>' + fdate(x.updated) + '</td><td class="r">' + money(x.total) + '</td><td>' + fdate(x.viewed) + '</td></tr>'; }).join('') + '</tbody></table></div></details>'; }
  function estTab(d) { var e = d.job.estimate, pr = d.job.proposals || []; return (e && (e.lines || []).length ? estimateView(e).replace('<details class="fold sub">', '<details class="fold sub" open>') : '<p class="dk-empty">No estimate loaded for this job yet.</p>') + (pr.length ? proposalsView(pr) : ''); }
  function jcbTab(d) { return d.rollup.budget.length ? jcb(d.rollup) : '<p class="dk-empty">No budget yet.</p>'; }
  function overview(d) {
    var r = d.rollup, p = r.price, b = r.billing, c = r.cost, att = [];
    d.pos.filter(function (x) { return x.status === 'draft'; }).forEach(function (x) { att.push(['po', x.id, x.number + ' ' + x.title, 'Purchase order waiting for approval']); });
    d.cos.filter(function (x) { return x.status === 'pending'; }).forEach(function (x) { var w = x.signers.filter(function (s) { return s.status === 'pending'; }).map(function (s) { return s.name; }).join(', '); att.push(['co', x.id, x.number + ' ' + x.title, 'Waiting on the client: ' + w]); });
    d.cos.filter(function (x) { return x.status === 'declined'; }).forEach(function (x) { att.push(['co', x.id, x.number + ' ' + x.title, 'Client declined']); });
    d.invoices.filter(function (x) { return x.display === 'Overdue'; }).forEach(function (x) { att.push(['inv', x.id, x.number + ' ' + x.title, 'Overdue, ' + money(x.totals.balance) + ' due ' + fdate(x.due_date)]); });
    d.invoices.filter(function (x) { return x.status === 'draft'; }).forEach(function (x) { att.push(['inv', x.id, x.number + ' ' + x.title, 'Draft invoice, not sent']); });
    var h = '<div class="big">' + kpi('Revised contract price', money(p.revised), 'Original ' + money(p.base) + ' + ' + money(p.co_approved) + ' approved changes') + kpi('Invoiced', money(b.invoiced), money(b.left_to_invoice) + ' left to invoice') + kpi('Paid by client', money(b.paid), money(b.balance) + ' still owed') + kpi('Projected profit', money(r.projected_profit)) + '</div>';
    h += '<div class="big">' + kpi('Revised budget', money(c.revised), 'Original ' + money(c.original) + ' + ' + money(c.co_cost) + ' changes') + kpi('Committed (approved POs)', money(c.committed)) + kpi('Actual costs', money(c.actual)) + kpi('Cost to complete', money(c.to_complete), money((r.bills && r.bills.unpaid_bills) || 0) + ' in bills waiting to pay') + '</div>';
    h += '<details class="fold sub" open><summary><h3>Needs attention · ' + att.length + '</h3></summary>' + (att.length ? '<ul class="al">' + att.map(function (a) { return '<li><div><b>' + esc(a[2]) + '</b><div class="dk-m">' + esc(a[3]) + '</div></div><button class="link" data-bf-open="' + a[0] + ':' + a[1] + '">Open →</button></li>'; }).join('') + '</ul>' : '<p class="dk-empty">Nothing waiting.</p>') + '</details>';
    h += '<details class="fold sub" open><summary><h3>Job costing budget</h3></summary>' + (r.budget.length ? jcb(r) : '<p class="dk-empty">No budget yet.</p>') + '</details>';
    if (d.job.estimate && (d.job.estimate.lines || []).length) h += estimateView(d.job.estimate);
    if ((d.job.proposals || []).length) h += proposalsView(d.job.proposals);
    h += clientBox(d);
    return h;
  }
  function clientBox(d) {
    var c = d.job.client || {}, sg = c.signers || [];
    return '<details class="fold sub"><summary><h3>Who approves for the client' + (sg.length ? ' · ' + sg.length : ' · not set') + '</h3></summary><form class="bf-form" data-bf-client><p class="dk-m">Change orders go to these people to approve online. Invoices go to the first one.</p>' +
      [0, 1].map(function (i) { var s = sg[i] || {}; return '<div class="bf-row"><label>Name<input name="n' + i + '" value="' + esc(s.name || '') + '"></label><label>Email<input name="e' + i + '" type="email" value="' + esc(s.email || '') + '"></label></div>'; }).join('') +
      '<button class="bf-btn" type="submit">Save</button></form></details>';
  }
  function estimateView(e) { // Estimate view like the old software: groups with their lines, rolling up to the budget cost codes
    var groups = [], by = {}; e.lines.forEach(function (l) { if (!by[l.group]) { by[l.group] = { name: l.group, lines: [], total: 0 }; groups.push(by[l.group]); } by[l.group].lines.push(l); by[l.group].total += l.cost; });
    var total = e.lines.reduce(function (a, l) { return a + l.cost; }, 0), rows = '';
    groups.forEach(function (g) { rows += '<tr class="grp"><td colspan="5"><b>' + esc(g.name) + '</b></td><td class="r"><b>' + money(g.total) + '</b></td><td></td><td></td></tr>'; g.lines.forEach(function (l) { rows += '<tr><td>' + esc(l.title) + '</td><td>' + esc(l.code) + '</td><td>' + esc(l.desc) + '</td><td class="r">' + l.qty + '</td><td class="r">' + money(l.unit_cost) + '</td><td class="r">' + money(l.cost) + '</td><td class="r">' + (l.markup == null ? '' : l.markup + '%') + '</td><td class="r">' + (l.markup == null ? '' : (l.unit_price != null ? '$' + Number(l.unit_price).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : money((l.unit_cost || 0) * (1 + l.markup / 100)))) + '</td></tr>'; }); });
    rows += '<tr class="grp"><td colspan="5"><b>Builder cost</b></td><td class="r"><b>' + money(total) + '</b></td><td></td><td></td></tr>' + (e.profit ? '<tr><td colspan="5">' + esc(e.profit_label || 'Profit') + '</td><td class="r">' + money(e.profit) + '</td></tr><tr class="grp"><td colspan="5"><b>Total price</b></td><td class="r"><b>' + money(e.price || total + e.profit) + '</b></td></tr>' : '');
    return '<details class="fold sub"><summary><h3>Estimate · ' + e.lines.length + ' lines' + (e.locked ? ' · ' + esc(e.locked) : '') + '</h3></summary><div class="tw"><table class="bt"><thead><tr><th>Title</th><th>Cost code</th><th>Description</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Builder cost</th><th class="r">Markup</th><th class="r">Unit price</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
  }
  function jcb(r) { // Job costing budget: same columns and grouping as the old software (category rows with cost codes under them)
    var cats = {}, order = []; r.budget.forEach(function (x) { var c = x.category || 'Uncategorized'; if (!cats[c]) { cats[c] = []; order.push(c); } cats[c].push(x); });
    order.sort();
    var cols = ['original', 'revised', 'pending', 'committed', 'actual'];
    function sum(a, k) { return a.reduce(function (t, x) { return t + (Number(x[k]) || 0); }, 0); }
    function cells(a) { var v = {}; cols.forEach(function (k) { v[k] = sum(a, k); }); v.projected = sum(a, 'projected'); v.toc = v.projected - v.actual; v.variance = v.revised - v.projected;
      return cols.map(function (k) { return '<td class="r">' + (v[k] ? money(v[k]) : '--') + '</td>'; }).join('') + '<td class="r' + (v.variance < 0 ? ' bf-neg' : '') + '">' + (v.variance ? money(v.variance) : '--') + '</td><td class="r">' + money(v.projected) + '</td><td class="r">' + money(v.toc) + '</td>'; }
    var rows = order.map(function (c) { var a = cats[c]; return '<tr class="grp"><td><b>' + esc(c) + '</b></td>' + cells(a) + '</tr>' + a.map(function (x) { return '<tr><td style="padding-left:22px">' + esc(x.code) + '</td>' + cells([x]) + '</tr>'; }).join(''); }).join('');
    var c = r.cost || {}, pr = r.price || {}, mg = pr.revised ? Math.round(r.projected_profit / pr.revised * 100) : 0;
    return '<div class="big">' + kpi('Revised price', money(pr.revised)) + kpi('Projected cost', money(c.projected)) + kpi('Projected profit', money(r.projected_profit), mg + '% profit margin') + '</div>' +
      '<div class="tw"><table class="bt"><thead><tr><th>Cost codes</th><th class="r">Original budget costs</th><th class="r">Revised budget costs</th><th class="r">Pending costs</th><th class="r">Committed costs</th><th class="r">Actual costs</th><th class="r">Builder variance</th><th class="r">Projected costs</th><th class="r">Cost to complete</th></tr></thead><tbody>' + rows +
      '<tr class="grp"><td><b>Totals</b></td>' + cells(r.budget) + '</tr></tbody></table></div>';
  }
  function badge(s) { var k = String(s).toLowerCase().replace(/\s+/g, '-'); return '<span class="bf-st bf-' + esc(k) + '">' + esc(s) + '</span>'; }
  var LOWP = ['RFIs','Comments','Client','Created','Files','Builder cost','Viewed','QuickBooks','Due'];   // less important columns drop out on a phone so price and status stay on screen
  function cc(c) { var k = (c[2] ? 'r' : '') + (LOWP.indexOf(c[0]) >= 0 ? ' lo' : ''); return k.trim() ? ' class="' + k.trim() + '"' : ''; }
  function table(cols, rows, kind, empty) {
    if (!rows.length) return '<p class="dk-empty">' + empty + '</p>';
    return '<div class="tw"><table class="bt bf-click"><thead><tr>' + cols.map(function (c) { return '<th' + cc(c) + '>' + c[0] + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr data-bf-open="' + kind + ':' + r.id + '" tabindex="0">' + cols.map(function (c) { var v = c[1](r); return '<td' + cc(c) + '>' + v + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function insBadge(v) { return v.insurance_status === 'ok' ? badge('Insured') : v.insurance_status === 'expiring' ? badge('Draft').replace('Draft', 'Expires ' + fdate(v.insurance_expires)) : v.insurance_status === 'expired' ? badge('Void').replace('Void', 'Insurance expired') : '<span class="dk-m">None on file</span>'; }
  function billList(d) {
    var bl = d.bills || [];
    return '<div class="bf-bar"><label class="bf-btn alt bf-file">Snap receipt<input type="file" accept="image/*" capture="environment" multiple hidden data-bf-rcpt></label><span class="dk-m">Receipts and supplier bills that aren’t on a purchase order. Paid amounts count as actual cost. For a PO, record the bill on the PO.</span></div>' +
      table([['Bill', function (r) { return esc(r.number); }], ['Title', function (r) { return esc(r.title); }], ['Pay to', function (r) { return esc(r.vendor.name); }], ['Status', function (r) { return badge(r.display); }], ['Amount', function (r) { return money(r.totals.amount); }, 1], ['Paid', function (r) { return money(r.totals.paid); }, 1], ['Remaining', function (r) { return money(r.totals.remaining); }, 1], ['Due', function (r) { return fdate(r.due_date); }]], bl, 'bill', 'No bills yet.');
  }
  function openBill(id) {
    var rec = id ? (S.data.bills || []).filter(function (x) { return x.id === id; })[0] : null;
    var b = rec ? JSON.parse(JSON.stringify(rec)) : { title: '', vendor: { name: '' }, cost_code: '', amount: '', bill_date: ymd(new Date()), due_date: '', notes: '', status: 'draft', payments: [], events: [] };
    var m = document.createElement('div'); m.className = 'bf-modal'; document.documentElement.classList.add('bf-lock');
    var can = S.cfg.can_approve, ro = b.status === 'void' || !!b.imported;
    function close() { m.remove(); document.documentElement.classList.remove('bf-lock'); }
    function paint() {
      var t = b.totals || { amount: n2(b.amount), paid: 0, remaining: n2(b.amount) };
      m.innerHTML = '<div class="bf-panel"><div class="bf-head"><div><b>Bill ' + esc(b.number || '(new)') + '</b> ' + badge(b.display || 'Draft') + '</div><button class="bf-x big" data-x>×</button></div><div class="bf-body"><form class="bf-form" data-bform><fieldset ' + (ro ? 'disabled' : '') + '><label>Title<input data-b="title" value="' + esc(b.title) + '"></label><div class="bf-row"><label>Pay to<input data-b="vendor.name" list="bf-vendors" value="' + esc(b.vendor.name) + '"></label><label>Cost code<input data-b="cost_code" list="bf-codes" value="' + esc(b.cost_code) + '"></label></div><div class="bf-row"><label>Amount<input data-b="amount" inputmode="decimal" value="' + esc(b.amount) + '"></label><label>Bill date<input data-b="bill_date" type="date" value="' + esc(b.bill_date) + '"></label><label>Due<input data-b="due_date" type="date" value="' + esc(b.due_date) + '"></label></div><label>Notes<input data-b="notes" value="' + esc(b.notes) + '"></label><div class="bf-row"><label>Purchase order<select data-b="po_id"><option value="">Not on a PO</option>' + (S.data.pos || []).filter(function (x) { return x.status !== 'void'; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === b.po_id ? ' selected' : '') + '>' + esc(x.number + ' ' + x.title) + '</option>'; }).join('') + '</select></label>' + (b.po_id ? '<label>PO line<select data-b="po_line"><option value="">Whole PO</option>' + ((((S.data.pos || []).filter(function (x) { return x.id === b.po_id; })[0] || {}).lines) || []).map(function (l, i) { return '<option value="' + i + '"' + (String(b.po_line) === String(i) ? ' selected' : '') + '>' + esc((l.desc || 'Line ' + (i + 1)) + (l.cost_code ? ' (' + l.cost_code + ')' : '')) + '</option>'; }).join('') + '</select></label>' : '') + '</div></fieldset></form><datalist id="bf-vendors">' + (S.vendors || []).map(function (v) { return '<option value="' + esc(v.name) + '">'; }).join('') + '</datalist><datalist id="bf-codes">' + (S.data.rollup.budget || []).map(function (x) { return '<option value="' + esc(x.code) + '">'; }).join('') + '</datalist>' +
        (b.status === 'approved' ? '<h4>Payments</h4>' + (b.payments.length ? '<div class="tw"><table class="bt"><thead><tr><th>Date</th><th>Method</th><th>Ref</th><th class="r">Amount</th><th></th></tr></thead><tbody>' + b.payments.map(function (p) { return '<tr><td>' + fdate(p.date) + '</td><td>' + esc(p.method) + '</td><td>' + esc(p.ref) + '</td><td class="r">' + money(p.amount) + '</td><td><button class="bf-x" data-delpay="' + p.id + '">×</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="dk-empty">None yet.</p>') + (t.remaining > 0.004 ? '<form class="bf-form bf-inline" data-bpay><input name="amount" inputmode="decimal" value="' + t.remaining + '" required><input name="date" type="date" value="' + ymd(new Date()) + '"><input name="method" placeholder="Method (card, check, ACH)"><input name="ref" placeholder="Ref"><button class="bf-btn" type="submit">Record payment</button></form>' : '') : '') +
        (b.possible_duplicate ? '<p class="bf-warn">This looks like a receipt already entered (' + esc(b.possible_duplicate.number) + '). Check before approving.</p>' : '') + (b.receipt_ref ? '<h4>Receipt photo</h4><div class="bf-rcpt" data-rimg>Loading photo…</div>' : '') + (b.id ? commentsBox(b) : '') + '<details class="fold sub"><summary><h3>History</h3></summary><ul class="bf-hist">' + (b.events || []).slice().reverse().map(function (e) { return '<li><time>' + ftime(e.at) + '</time> <b>' + esc(e.who) + '</b> ' + esc(e.what) + '</li>'; }).join('') + '</ul></details></div><div class="bf-foot">' + (ro ? '' : '<button class="bf-btn" data-bact="save">Save</button>' + (b.status === 'draft' && b.id ? '<button class="bf-btn alt" data-bact="review">Send for review</button>' : '') + (b.status === 'review' ? '<button class="bf-btn alt" data-bact="back">Back to draft</button>' : '') + ((b.status === 'draft' || b.status === 'review') && b.id && can ? '<button class="bf-btn" data-bact="approve">Approve</button>' : '') + (b.id && b.status === 'draft' ? '<button class="bf-btn alt" data-bact="delete">Delete</button>' : '') + (b.status === 'approved' && !b.payments.length ? '<button class="bf-btn alt" data-bact="void">Void</button>' : '')) + '<button class="bf-btn alt" data-x>Close</button></div></div>';
    }
    function act(a, extra) { return call('POST', 'bill/act', Object.assign({ job: S.job.id, id: b.id, action: a }, extra || {})).then(function (r) { if (!r.ok) { flash(r.error, true); return; } if (r.deleted) { close(); flash('Deleted.'); load(); return; } b = r.bill; flash(a === 'payment' ? 'Payment recorded.' : a === 'approve' ? 'Approved.' : 'Done.'); paint(); load(); }); }
    function save() { return call('POST', 'bill/save', { job: S.job.id, id: b.id, title: b.title, vendor: b.vendor, cost_code: b.cost_code, amount: b.amount, bill_date: b.bill_date, due_date: b.due_date, notes: b.notes, po_id: b.po_id, po_line: b.po_line }).then(function (r) { if (!r.ok) { flash(r.error, true); return null; } b = r.bill; flash('Saved ' + b.number + '.'); paint(); load(); return b; }); }
    m.addEventListener('input', function (e) { var k = e.target.dataset.b; if (k) { if (k === 'vendor.name') b.vendor.name = e.target.value; else b[k] = e.target.value; } });
    m.addEventListener('change', function (e) { if (e.target.dataset.b === 'po_id') { b.po_line = null; paint(); photo(); } });
    m.addEventListener('click', function (e) { var t = e.target, x;
      if (t.closest('[data-x]')) return close();
      if ((x = t.closest('[data-bact]'))) { var a = x.dataset.bact; if (a === 'save') save(); else if (a === 'review') save().then(function (r) { if (r) act('review'); }); else if (a === 'back') act('back_to_draft'); else if (a === 'approve') save().then(function (r) { if (r) act('approve'); }); else if (a === 'void') { if (confirm('Void this bill?')) act('void'); } else if (a === 'delete') { if (confirm('Delete this draft?')) act('delete'); } return; }
      if ((x = t.closest('[data-delpay]'))) act('payment_delete', { payment_id: x.dataset.delpay }); });
    m.addEventListener('submit', function (e) { e.preventDefault(); if (e.target.hasAttribute('data-bf-comment')) { var cf = e.target; call('POST', 'comment/add', { job: S.job.id, kind: 'bill', id: b.id, text: cf.text.value }).then(function (r) { if (!r.ok) return flash(r.error, true); b.comments = r.comments; paint(); photo(); }); return; } if (e.target.hasAttribute('data-bpay')) { var f = e.target; act('payment', { amount: f.amount.value, date: f.date.value, method: f.method.value, ref: f.ref.value }); } });
    function photo() { var h = m.querySelector('[data-rimg]'); if (!h || !b.receipt_ref || h.dataset.done) return; h.dataset.done = 1; call('GET', 'receipt/img?job=' + encodeURIComponent(S.job.id) + '&id=' + encodeURIComponent(b.receipt_ref)).then(function (r) { if (!r.ok) { h.textContent = 'Photo not available.'; return; } h.innerHTML = '<img alt="Receipt" src="data:' + r.mime + ';base64,' + r.image + '">'; }); }
    paint(); S.el.appendChild(m); photo();
  }
  // phone photo -> smaller JPEG -> service reads it -> draft bill
  function shrink(file) {
    return new Promise(function (ok, no) {
      var img = new Image(), u = URL.createObjectURL(file);
      img.onload = function () { var m = 1600, sc = Math.min(1, m / Math.max(img.width, img.height)), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(u); ok(c.toDataURL('image/jpeg', 0.8).split(',')[1]); };
      img.onerror = function () { URL.revokeObjectURL(u); no(new Error('That file is not a photo I can open.')); };
      img.src = u;
    });
  }
  function uploadReceipts(files) {
    var list = [].slice.call(files), n = 0, bad = 0, dup = 0;
    flash('Reading ' + list.length + ' receipt' + (list.length > 1 ? 's' : '') + '…');
    return list.reduce(function (p, f) {
      return p.then(function () { return shrink(f).then(function (b64) { return call('POST', 'receipt/upload', { job: S.job.id, mime: 'image/jpeg', image: b64 }); }).then(function (r) { if (r.ok) { n++; if (r.bill.possible_duplicate) dup++; if (!r.read) bad++; } else bad++; }).catch(function () { bad++; }); });
    }, Promise.resolve()).then(function () { flash(n + ' receipt' + (n === 1 ? '' : 's') + ' added as draft ' + (n === 1 ? 'bill' : 'bills') + '. Check ' + (n === 1 ? 'it' : 'each one') + ', then approve.' + (dup ? ' ' + dup + ' may be duplicates.' : '') + (bad ? ' ' + bad + ' could not be read; open them and fill in the details.' : ''), bad > 0); return load(); });
  }
  function vendorTab() {
    var vs = S.vendors || [], ev = S.vEdit || null;
    var f = '<form class="bf-form" data-bf-vendor><input type="hidden" name="id" value="' + esc(ev ? ev.id : '') + '"><div class="bf-row"><label>Name<input name="name" required value="' + esc(ev ? ev.name : '') + '"></label><label>Trade<input name="trade" value="' + esc(ev ? ev.trade : '') + '"></label></div><div class="bf-row"><label>Email<input name="email" type="email" value="' + esc(ev ? ev.email : '') + '"></label><label>Phone<input name="phone" value="' + esc(ev ? ev.phone : '') + '"></label></div><div class="bf-row"><label>Insurance expires<input name="insurance_expires" type="date" value="' + esc(ev ? ev.insurance_expires : '') + '"></label><label class="bf-chk"><input name="w9_on_file" type="checkbox" ' + (ev && ev.w9_on_file ? 'checked' : '') + '> W-9 on file</label></div><div class="bf-row"><label>Workers comp expires<input name="workers_comp_expires" type="date" value="' + esc(ev ? ev.workers_comp_expires : '') + '"></label><label>Payment method<input name="payment_method" list="bf-paym" value="' + esc(ev ? ev.payment_method : '') + '"></label><label>Trade agreement<select name="trade_agreement"><option value="">None</option><option value="sent"' + (ev && ev.trade_agreement === 'sent' ? ' selected' : '') + '>Sent</option><option value="signed"' + (ev && ev.trade_agreement === 'signed' ? ' selected' : '') + '>Signed</option></select></label></div><datalist id="bf-paym"><option>Check</option><option>ACH</option><option>Wire</option><option>Card</option></datalist><label>More contacts (one per line: name, role, phone, email)<textarea name="contacts" rows="2">' + esc(ev ? (ev.contacts || []).map(function (c) { return [c.name, c.role, c.phone, c.email].join(', '); }).join('\n') : '') + '</textarea></label><label>Notes<input name="notes" value="' + esc(ev ? ev.notes : '') + '"></label><div class="bf-bar"><button class="bf-btn" type="submit">' + (ev ? 'Save changes' : 'Add vendor') + '</button>' + (ev ? '<button class="bf-btn alt" type="button" data-bf-vcancel>Cancel</button>' : '') + '</div></form>';
    var t = vs.length ? '<div class="tw"><table class="bt"><thead><tr><th>Name</th><th>Trade</th><th>Email</th><th>Phone</th><th>Insurance</th><th>Workers comp</th><th>Pays by</th><th>Agreement</th><th>W-9</th><th></th></tr></thead><tbody>' + vs.map(function (v) { return '<tr><td>' + esc(v.name) + '</td><td>' + esc(v.trade) + '</td><td>' + esc(v.email) + '</td><td>' + esc(v.phone) + '</td><td>' + insBadge(v) + '</td><td>' + insBadge({ insurance_status: v.workers_comp_status, insurance_expires: v.workers_comp_expires }) + '</td><td>' + esc(v.payment_method || '') + '</td><td>' + esc(v.trade_agreement === 'signed' ? 'Signed' : v.trade_agreement === 'sent' ? 'Sent' : '') + '</td><td>' + (v.w9_on_file ? 'Yes' : '') + '</td><td><button class="link" data-bf-vedit="' + esc(v.id) + '">Edit</button> <button class="bf-x" data-bf-vdel="' + esc(v.id) + '" title="Remove">×</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="dk-empty">No vendors yet. Add the subs and suppliers you use; they show up when you make a purchase order.</p>';
    return '<div class="bf-bar"><span class="dk-m">Everyone you buy from, shared by all jobs.</span></div>' + t + '<details class="fold sub"' + (ev || !vs.length ? ' open' : '') + '><summary><h3>' + (ev ? 'Edit vendor' : 'Add a vendor') + '</h3></summary>' + f + '</details>';
  }
  function poList(d) {
    return '<div class="bf-bar"><button class="bf-btn" data-bf-new="po">+ Purchase order</button><span class="dk-m">Approved POs count as committed costs.</span></div>' +
      table([['PO #', function (r) { return esc(r.number) + (r.imported ? ' <small class="bf-imp">Imported</small>' : ''); }], ['Title', function (r) { return esc(r.title); }], ['Performed by', function (r) { return esc(r.vendor.name); }], ['Status', function (r) { return badge(r.display); }], ['Work', function (r) { return r.status === 'void' ? '' : esc(r.work_status === 'complete' ? 'Complete' : 'Not complete'); }], ['Cost', function (r) { return money(r.totals.cost); }, 1], ['Paid', function (r) { return money(r.totals.paid); }, 1], ['Remaining', function (r) { return money(r.totals.remaining); }, 1]], d.pos, 'po', 'No purchase orders yet.');
  }
  function coList(d) {
    var rf = d.rfis || [], poN = {}; (d.pos || []).forEach(function (p) { poN[p.id] = p.number; });
    var cl = (d.job.client && d.job.client.name) || '';
    var tc = 0, tp = 0; d.cos.forEach(function (c) { if (c.status !== 'void') { tc += c.totals.builder; tp += c.totals.price; } });
    var rows = d.cos.slice().sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
    var cols = [['CO ID', function (r) { return esc(r.number) + (r.imported ? ' <small class="bf-imp">Imported</small>' : ''); }], ['Title', function (r) { return esc(r.title); }],
      ['RFIs', function (r) { return rf.filter(function (x) { return x.link_kind === 'co' && x.link_id === r.id; }).length || ''; }], ['Comments', function (r) { return (r.comments || []).length || ''; }],
      ['Client', function () { return esc(cl); }], ['Created', function (r) { return fdate((r.created_at || '').slice(0, 10)); }], ['Files', function (r) { return (r.attachments || []).length || ''; }],
      ['Builder cost', function (r) { return money(r.totals.builder); }, 1], ['Total price', function (r) { return money(r.totals.price); }, 1],
      ['Status', function (r) { return badge(r.superseded ? 'Replaced' : r.status === 'pending' ? 'Waiting on client' : r.status.charAt(0).toUpperCase() + r.status.slice(1)); }],
      ['Status changed', function (r) { return fdate((r.decided_at || r.sent_at || r.created_at || '').slice(0, 10)); }],
      ['Related POs', function (r) { return esc((r.po_ids || []).map(function (id) { return poN[id]; }).filter(Boolean).join(', ')); }],
      ['Signed', function (r) { var sg = (r.signers || []).filter(function (x) { return x.status === 'approved'; }); return sg.length ? fdate((sg[sg.length - 1].signed_at || '').slice(0, 10)) + (sg.length < (r.signers || []).length ? ' (' + sg.length + '/' + r.signers.length + ')' : '') : ''; }],
      ['Evidence', function (r) { return r.approval_pdf ? '<button class="link" type="button" data-bf-fdl="' + esc(r.approval_pdf) + '">Approval PDF</button>' : '';}],
      ['', function (r) { return '<button class="bf-btn alt sm" type="button" data-bf-open="co:' + esc(r.id) + '">' + (r.status === 'draft' || r.status === 'pending' ? 'Edit' : 'View') + '</button>'; }]];
    var h = billingCard(d) + '<div class="bf-bar"><button class="bf-btn" data-bf-new="co">+ Change order</button><span class="dk-m">Approved changes raise the contract price and the budget.</span></div>' + table(cols, rows, 'co', 'No change orders yet.');
    if (rows.length) h += '<p class="dk-m" style="text-align:right"><b>Totals</b> · builder cost ' + money(tc) + ' · total price ' + money(tp) + ' (void excluded)</p>';
    return h;
  }
  function billingCard(d) {
    var rows = (d.cos || []).filter(function (c) { return c.billing && c.billing.status === 'awaiting_approval'; });
    if (!rows.length) return '';
    var can = S.cfg.settings.can_send_invoice;
    return '<div class="bf-ready"><b>Signed change orders to bill · ' + rows.length + '</b>' + rows.map(function (c) { return '<div class="bf-ready-row"><span>' + esc(c.number) + ' ' + esc(c.title) + ' · ' + money(c.billing.amount) + '</span>' + (can ? '<span class="bf-ready-btns"><button class="bf-btn" data-bf-bill="approve:' + esc(c.id) + '">Approve billing</button><button class="bf-btn alt" data-bf-bill="dismiss:' + esc(c.id) + '">Not now</button></span>' : '<small class="dk-m">Waiting on the approver</small>') + '</div>'; }).join('') + '<small class="dk-m">Approved billing goes to QuickBooks as an invoice' + (S.cfg.settings.qbo && S.cfg.settings.qbo.enabled ? '.' : ' once QuickBooks is connected. Until then it is held.') + '</small></div>';
  }
  function invReady(d) {
    var rows = (d.invoices || []).filter(function (i) { return i.status === 'draft' && i.draw_id; });
    if (!rows.length) return '';
    var can = S.cfg.settings.can_send_invoice;
    return '<div class="bf-ready"><b>Ready for approval · ' + rows.length + '</b>' + rows.map(function (i) { return '<div class="bf-ready-row"><span>' + esc(i.title) + ' · ' + money(i.totals.total) + (i.client && i.client.name ? ' · ' + esc(i.client.name) : '') + '</span><button class="bf-btn" data-bf-open="inv:' + esc(i.id) + '">' + (can ? 'Review & send' : 'Review') + '</button></div>'; }).join('') + (can ? '' : '<small class="dk-m">Only ' + esc((S.cfg.settings.invoice_approvers || []).join(', ') || 'the approver') + ' can send.</small>') + '</div>';
  }
  function invSettings() {
    if (!S.cfg.user || S.cfg.user.role !== 'owner') return '';
    var st = S.cfg.settings;
    return '<details class="fold sub bf-iset"><summary><h3>Invoice settings</h3></summary><label>Who sends invoices (names, comma separated; blank = any approver)<input data-bf-iapp value="' + esc((st.invoice_approvers || []).join(', ')) + '"></label><label class="bf-chk"><input type="checkbox" data-bf-iqb' + (st.qbo && st.qbo.enabled ? ' checked' : '') + '> Hand sent invoices to QuickBooks (turn on after QuickBooks is connected)</label><button class="bf-btn alt" data-bf-isave>Save</button></details>';
  }
  function invList(d) {
    return billingCard(d) + invReady(d) + invSettings() + '<div class="bf-bar"><button class="bf-btn" data-bf-new="inv">+ Invoice</button><button class="bf-btn alt" data-bf-draws>Payment schedule</button><button class="bf-btn alt" data-bf-qb>QuickBooks export</button></div>' +
      table([['Invoice', function (r) { return esc(r.number) + (r.imported ? ' <small class="bf-imp">Imported</small>' : ''); }], ['Title', function (r) { return esc(r.title); }], ['Status', function (r) { return badge(r.display); }], ['Total', function (r) { return money(r.totals.total); }, 1], ['Paid', function (r) { return money(r.totals.paid); }, 1], ['Balance due', function (r) { return money(r.totals.balance); }, 1], ['Viewed', function (r) { return r.viewed_at ? 'Yes' : ''; }], ['Due', function (r) { return fdate(r.due_date); }], ['QuickBooks', function (r) { return r.qb && r.qb.status === 'synced' ? 'Synced' : r.qb && (r.qb.status === 'ready' || r.qb.status === 'queued') ? (r.qb.status === 'queued' ? 'Queued' : 'Ready') : '—'; }]], d.invoices, 'inv', 'No invoices yet.');
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
      if (kind === 'co') Object.assign(base, { invoice_on_approval: true, description: '', days_impact: 0, signers_planned: cs.map(function (s) { return { name: s.name, email: s.email }; }), approval_deadline: '', notes_internal: '' });
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
  // read-only record from the old system: a plain summary instead of a form full of empty fields
  function importedSummary(k, r) {
    var t = r.totals || {}, total = k === 'inv' ? t.total : (t.price != null ? t.price : t.total), nm = k === 'po' ? 'purchase order' : k === 'co' ? 'change order' : 'invoice';
    var st = k === 'co' ? ({ draft: 'Draft', pending: 'Waiting on client', approved: 'Approved', declined: 'Declined', void: 'Void' }[r.status]) : (r.display || r.status);
    var next = r.superseded ? 'Replaced by ' + r.superseded.number + ', the BuildFlow copy. This one is kept for the record.' : r.status === 'draft' ? 'Still a draft. It was not sent from the old system. Create it again here with + ' + (k === 'co' ? 'Change order' : k === 'po' ? 'PO' : 'Invoice') + ' to send it.' : r.status === 'void' ? 'Nothing. It was voided.' : k === 'inv' ? (t.balance > 0.004 ? money(t.balance) + ' is still due.' : 'Nothing. It is paid.') : 'Nothing. It is done and counted in the job total.';
    var out = '<div class="bf-sum"><div class="bf-sum-top"><div><div class="dk-m">' + esc(nm) + ' copied from your current software</div><h3>' + esc(r.title || r.number) + '</h3></div><div class="bf-sum-total">' + money(total) + '<small>' + esc(st || '') + '</small></div></div>' +
      '<p><b>Next step:</b> ' + esc(next) + '</p>' + (r.approval_deadline ? '<p class="dk-m">Respond by ' + fdate(r.approval_deadline) + '</p>' : '') + (r.description ? '<p>' + esc(r.description) + '</p>' : '') + '</div>';
    var ls = (r.lines || []).filter(function (l) { return !/^Imported from your current software/.test(l.desc || ''); });
    if (ls.length) out += '<h4>What it covers</h4><ul class="bf-sum-lines">' + ls.map(function (l, i) { var pr = l.price_override != null ? l.price_override : r2(n2(l.unit_cost) * (l.qty == null || l.qty === '' ? 1 : n2(l.qty)) * (1 + n2(l.markup_pct) / 100)); return '<li><span>' + esc(l.desc) + (l.cost_code ? '<small>' + esc(l.cost_code) + '</small>' : '') + '</span><b>' + money(pr) + '</b></li>'; }).join('') + '</ul>';
    return out;
  }
  function drawEditor() {
    var ed = S.ed; if (!ed) return; var k = ed.kind, r = ed.rec, d = S.data, can = S.cfg.can_approve;
    var locked = (k === 'po' && r.status === 'void') || (k === 'co' && r.status !== 'draft') || (k === 'inv' && r.status === 'void') || r.imported;
    var title = (k === 'po' ? 'Purchase order' : k === 'co' ? 'Change order' : 'Invoice') + (r.number ? ' ' + r.number : ' (new)');
    var stat = k === 'po' ? r.display || 'Draft' : k === 'co' ? ({ draft: 'Draft', pending: 'Waiting on client', approved: 'Approved', declined: 'Declined', void: 'Void' }[r.status]) : r.display || 'Draft';
    var h = '<div class="bf-head"><div><b>' + esc(title) + '</b> ' + badge(stat) + (r.imported ? ' <small class="bf-imp">from your current software</small>' : '') + '</div><button class="bf-x big" data-bf-close aria-label="Close">×</button></div><div class="bf-body">';
    if (k === 'po' && r.status === 'draft' && r.vendor && r.vendor.name) { var vv = (S.vendors || []).filter(function (x) { return x.name.toLowerCase() === r.vendor.name.toLowerCase(); })[0]; if (vv && (vv.insurance_status === 'expired' || vv.insurance_status === 'none')) h += '<p class="bf-warn">' + esc(vv.name) + ' has ' + (vv.insurance_status === 'expired' ? 'insurance that expired ' + fdate(vv.insurance_expires) : 'no insurance on file') + '. Check before you approve.</p>'; else if (!vv) h += '<p class="dk-m">Not in your vendor list yet. Add them under Vendors to track insurance.</p>'; }
    if (k === 'po' && r.approved_by) h += '<p class="dk-m">Approved by ' + esc(r.approved_by) + ' on ' + fdate((r.approved_at || '').slice(0, 10)) + '</p>';
    var hForm = h.length;
    h += '<form class="bf-form" data-bf-form autocomplete="off"><fieldset ' + (locked ? 'disabled' : '') + '>';
    h += '<label>Title<input data-f="title" value="' + esc(r.title) + '"></label>';
    if (k === 'po') h += '<div class="bf-row"><label>Assigned to (who is doing the work)<input data-f="vendor.name" list="bf-vendors" value="' + esc(r.vendor.name) + '"></label><datalist id="bf-vendors">' + (S.vendors || []).map(function (v) { return '<option value="' + esc(v.name) + '">'; }).join('') + '</datalist><label>Their email<input data-f="vendor.email" type="email" value="' + esc(r.vendor.email) + '"></label></div><div class="bf-row"><label>Scheduled completion<input data-f="due_date" type="date" value="' + esc(r.due_date) + '"></label><label class="bf-chk"><input data-f="materials_only" type="checkbox" ' + (r.materials_only ? 'checked' : '') + '> Materials only</label><label class="bf-chk"><input data-f="variance.is" type="checkbox" ' + (r.variance && r.variance.is ? 'checked' : '') + '> Variance PO</label></div><label>Scope of work<textarea data-f="scope" rows="3">' + esc(r.scope) + '</textarea></label>';
    if (k === 'co') h += '<label>Description for the client<textarea data-f="description" rows="3">' + esc(r.description) + '</textarea></label><div class="bf-row"><label>Days added to schedule<input data-f="days_impact" inputmode="numeric" value="' + esc(r.days_impact || 0) + '"></label><label>Respond by<input data-f="approval_deadline" type="date" value="' + esc(r.approval_deadline) + '"></label></div><div class="bf-row"><label>How is this billed?<select data-f="payment_effect"><option value="">Choose…</option><option value="billed_with_next_progress"' + (r.payment_effect === 'billed_with_next_progress' ? ' selected' : '') + '>With the next progress payment</option><option value="billed_on_approval"' + (r.payment_effect === 'billed_on_approval' ? ' selected' : '') + '>When approved</option><option value="custom"' + (r.payment_effect === 'custom' ? ' selected' : '') + '>Custom</option></select></label><label>Custom billing wording<input data-f="payment_text" value="' + esc(r.payment_text || '') + '"></label></div><label class="bf-chk"><input type="checkbox" data-f="invoice_on_approval"' + (r.invoice_on_approval ? ' checked' : '') + '> When this is signed, ask the approver to approve billing it (goes to QuickBooks)</label><label>Plans and specs link<input data-f="plans_url" value="' + esc(r.plans_url || '') + '" placeholder="https://…"></label><label>Scope sections for the agreement (a heading on its own line, then the text; blank line between sections)<textarea data-f="_sections" rows="6" placeholder="Summary&#10;What this change covers…">' + esc(r._sections != null ? r._sections : (r.sections || []).map(function (x) { return x.title + '\n' + x.body; }).join('\n\n')) + '</textarea></label><div class="bf-bar"><button type="button" class="bf-btn alt" data-bf-sectpl>Use the standard section headings</button></div>';
    if (k === 'inv') {
      var draws = (d.job.draws || []).filter(function (x) { return !x.invoice_id || x.invoice_id === r.id; });
      h += '<div class="bf-row"><label>Bill to<input data-f="client.name" value="' + esc(r.client.name) + '"></label><label>Their email<input data-f="client.email" type="email" value="' + esc(r.client.email) + '"></label></div>' +
        '<div class="bf-row"><label>Invoice date<input data-f="invoice_date" type="date" value="' + esc(r.invoice_date) + '"></label><label>Payment terms<select data-f="terms">' + S.cfg.settings.payment_terms.map(function (t) { return '<option' + (t === r.terms ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></label><label>Due<input data-f="due_date" type="date" value="' + esc(r.due_date) + '"></label></div>' +
        '<div class="bf-row"><label>Milestone / draw<input data-f="milestone" value="' + esc(r.milestone) + '" list="bf-draws"></label><label>Build it as<select data-f="mode"><option value="lines"' + (r.mode === 'lines' ? ' selected' : '') + '>Line items</option><option value="flat"' + (r.mode === 'flat' ? ' selected' : '') + '>Flat fee</option></select></label></div><datalist id="bf-draws">' + draws.map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('') + '</datalist>';
    }
    var flat = k === 'inv' && r.mode === 'flat';
    if (flat) h += '<label>Amount<input data-f="flat_amount" inputmode="decimal" value="' + esc(r.flat_amount) + '"></label>';
    else h += '<div class="tw"><table class="bf-lines"><thead><tr><th>Item</th><th>Cost type</th><th>Cost code</th><th class="q">Unit cost</th><th class="q">Qty</th><th class="u">Unit</th>' + (k !== 'po' ? '<th class="mk">Markup %</th>' : '') + '<th class="r">' + (k === 'po' ? 'Total' : 'Client price') + '</th><th></th></tr></thead><tbody>' + (r.lines || []).map(function (l, i) { return lineRow(l, i, k, locked); }).join('') + '</tbody></table></div>' + (locked ? '' : '<div class="bf-bar"><button type="button" class="bf-btn alt" data-bf-addline>+ Add line</button>' + (k === 'co' ? '<button type="button" class="bf-btn alt" data-bf-addline="group">+ Add group</button><button type="button" class="bf-btn alt" data-bf-addline="allowance">+ Add allowance</button><button type="button" class="bf-btn alt" data-bf-addline="flat">+ Add flat fee</button><button type="button" class="bf-btn alt" data-bf-preview>Client preview</button>' : '') + (k === 'inv' ? '<button type="button" class="bf-btn alt" data-bf-addco>+ Add approved change order</button>' : '') + '</div>') + '<datalist id="bf-codes">' + (d.rollup.budget || []).map(function (b) { return '<option value="' + esc(b.code) + '">'; }).join('') + '</datalist>';
    h += '<div class="bf-tot" data-tot></div>';
    if (k === 'inv') h += '<div class="bf-row"><label>Tax %<input data-f="tax_pct" inputmode="decimal" value="' + esc(r.tax_pct) + '"></label><label>Retainage %<input data-f="retainage_pct" inputmode="decimal" value="' + esc(r.retainage_pct) + '"></label></div><label>Note to the client<textarea data-f="notes_client" rows="2">' + esc(r.notes_client) + '</textarea></label>';
    if (k === 'co') h += '<h4>Who approves</h4>' + ((r.status === 'draft' ? r.signers_planned : r.signers) || []).map(function (s, i) { return '<div class="bf-row"><label>Name<input data-sg="' + i + ':name" value="' + esc(s.name) + '" ' + (r.status === 'draft' ? '' : 'disabled') + '></label><label>Email<input data-sg="' + i + ':email" value="' + esc(s.email) + '" ' + (r.status === 'draft' ? '' : 'disabled') + '></label>' + (r.status !== 'draft' ? '<span class="bf-sgst">' + badge(s.status === 'approved' ? 'Approved' : s.status === 'declined' ? 'Declined' : 'Waiting') + (s.signed_at ? '<small>' + esc(s.signed_name || '') + ' · ' + ftime(s.signed_at) + '</small>' : '') + '</span>' : '') + '</div>'; }).join('') + (r.status === 'draft' ? '<button type="button" class="bf-btn alt" data-bf-addsg>+ Add approver</button>' : '') + (r.manual ? '<p class="dk-m">Approved manually by ' + esc(r.manual.by) + ': ' + esc(r.manual.note) + '</p>' : '');
    if (k === 'po') h += '<div class="bf-row"><label>Internal notes (never shown to the vendor)<textarea data-f="notes_internal" rows="2">' + esc(r.notes_internal) + '</textarea></label><label>Notes to the vendor<textarea data-f="notes_vendor" rows="2">' + esc(r.notes_vendor) + '</textarea></label></div>';
    else h += '<label>Internal notes (never shown to the client)<textarea data-f="notes_internal" rows="2">' + esc(r.notes_internal) + '</textarea></label>';

    if (k === 'po') {
      var optPo = function (sel) { return '<option value="">None</option>' + (d.pos || []).filter(function (x) { return x.id !== r.id; }).map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.number + ' ' + x.title) + '</option>'; }).join(''); };
      var optCo = function (sel) { return '<option value="">None</option>' + (d.cos || []).map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.number + ' ' + x.title) + '</option>'; }).join(''); };
      h += '<div class="bf-row"><label>Completion date<input data-f="completion_date" type="date" value="' + esc(r.completion_date || '') + '"></label><label>Plans and specs link<input data-f="plans_url" value="' + esc(r.plans_url || '') + '" placeholder="https://…"></label></div>' +
        '<div class="bf-row"><label>Linked purchase order<select data-f="ref_po">' + optPo(r.ref_po) + '</select></label><label>Linked change order<select data-f="ref_co">' + optCo(r.ref_co) + '</select></label></div>';
    }
    if (k === 'co') {
      h += '<div class="bf-row"><label>Notes to the client<textarea data-f="notes_client" rows="2">' + esc(r.notes_client || '') + '</textarea></label><label>Notes to the sub/vendor<textarea data-f="notes_vendor" rows="2">' + esc(r.notes_vendor || '') + '</textarea></label></div>' +
        '<label>Terms (leave blank to use your standard terms)<textarea data-f="terms" rows="2">' + esc(r.terms || '') + '</textarea></label>' +
        '<label>Subs/vendors on this change order (comma separated)<input data-subs value="' + esc((r.subs || []).join(', ')) + '" list="bf-vendors2"></label><datalist id="bf-vendors2">' + (S.vendors || []).map(function (v) { return '<option value="' + esc(v.name) + '">'; }).join('') + '</datalist>' +
        ((d.pos || []).length ? '<h4>Related purchase orders</h4><div class="bf-checks">' + d.pos.map(function (x) { return '<label class="bf-chk"><input type="checkbox" data-poid="' + esc(x.id) + '"' + ((r.po_ids || []).indexOf(x.id) >= 0 ? ' checked' : '') + '> ' + esc(x.number + ' ' + x.title) + '</label>'; }).join('') + '</div>' : '');
    }
    h += '</fieldset></form>';
    if (r.imported) h = h.slice(0, hForm) + importedSummary(k, r);
    if (!S.ed.isNew) h += attachBox(r, k) + (k === 'po' ? waiverBox(r) : '');
    // bills / payments
    if (k === 'po' && r.status === 'approved') h += '<h4>Bills</h4>' + payTable(r.bills, 'bill_delete', 'bill_id') + (r.totals.remaining > 0.004 ? '<form class="bf-form bf-inline" data-bf-pay="bill"><input name="amount" inputmode="decimal" placeholder="Amount" required><input name="date" type="date" value="' + ymd(new Date()) + '"><input name="method" placeholder="Method (check, ACH, card)"><input name="ref" placeholder="Bill / ref #"><button class="bf-btn" type="submit">Record bill</button></form>' : '');
    if (k === 'inv' && r.status !== 'draft' && r.status !== 'void') h += '<h4>Payments</h4>' + payTable(r.payments, 'payment_delete', 'payment_id') + (r.totals.balance > 0.004 ? '<form class="bf-form bf-inline" data-bf-pay="payment"><input name="amount" inputmode="decimal" placeholder="Amount" value="' + r.totals.balance + '" required><input name="date" type="date" value="' + ymd(new Date()) + '"><input name="method" placeholder="Method" value="Check"><input name="ref" placeholder="Check # / ref"><button class="bf-btn" type="submit">Record payment</button></form>' : '');
    if (k === 'inv' && r.qb) h += '<p class="dk-m">QuickBooks: ' + (r.qb.status === 'synced' ? 'synced' + (r.qb.qbo_id ? ' (#' + esc(r.qb.qbo_id) + ')' : '') : r.qb.status === 'ready' ? 'ready to sync later (not connected yet)' : 'not ready until sent') + '</p>';
    if (S.review) h += reviewBox();
    h += '<details class="fold sub"><summary><h3>History</h3></summary><ul class="bf-hist">' + (r.events || []).slice().reverse().map(function (e) { return '<li><time>' + ftime(e.at) + '</time> <b>' + esc(e.who) + '</b> ' + esc(e.what) + '</li>'; }).join('') + '</ul></details>';
    if (!S.ed.isNew) h += commentsBox(r);
    h += '</div><div class="bf-foot">' + actions(k, r, locked, can) + '</div>';
    var m = S.el.querySelector('.bf-modal');
    if (!m) { m = document.createElement('div'); m.className = 'bf-modal'; m.setAttribute('data-editor', '1'); S.el.appendChild(m); document.documentElement.classList.add('bf-lock'); }
    var keep = m.querySelector('.bf-body'), st = keep ? keep.scrollTop : 0;
    m.innerHTML = '<div class="bf-panel" role="dialog" aria-modal="true">' + h + '</div>';
    var nb = m.querySelector('.bf-body'); if (nb) nb.scrollTop = st;
    refreshTotals();
  }
  function commentsBox(r) {
    return '<h4>Comments</h4>' + ((r.comments || []).length ? '<ul class="bf-hist">' + r.comments.map(function (c) { return '<li><time>' + ftime(c.at) + '</time> <b>' + esc(c.who) + '</b> ' + esc(c.text) + '</li>'; }).join('') + '</ul>' : '<p class="dk-empty">No comments yet. These are for your team only.</p>') +
      '<form class="bf-form bf-inline" data-bf-comment><input name="text" placeholder="Add a comment for the team" required><button class="bf-btn alt" type="submit">Post</button></form>';
  }
  function payTable(rows, act, idf) {
    if (!rows || !rows.length) return '<p class="dk-empty">None recorded yet.</p>';
    return '<div class="tw"><table class="bt"><thead><tr><th>Date</th><th>Method</th><th>Ref</th><th class="r">Amount</th><th></th></tr></thead><tbody>' + rows.map(function (p) { return '<tr><td>' + fdate(p.date) + '</td><td>' + esc(p.method) + '</td><td>' + esc(p.ref) + '</td><td class="r">' + money(p.amount) + '</td><td>' + (S.ed.rec.imported ? '' : '<button class="bf-x" data-bf-act="' + act + '" data-idf="' + idf + '" data-idv="' + p.id + '" title="Remove">×</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function actions(k, r, locked, can) {
    var h0 = actions0(k, r, locked, can);
    if (k !== 'co' || S.ed.isNew) return h0;
    var bb = function (a, label, cls) { return '<button class="bf-btn ' + (cls || '') + '" type="button" data-bf-act="' + a + '">' + label + '</button>'; };
    return bb('contract', 'Preview contract', 'alt') + (r.imported && r.status === 'draft' ? bb('finish', 'Finish in BuildFlow') : '') + h0;
  }
  function actions0(k, r, locked, can) {
    var b = function (a, label, cls) { return '<button class="bf-btn ' + (cls || '') + '" type="button" data-bf-act="' + a + '">' + label + '</button>'; };
    var h = '';
    if (r.imported) return b('close', 'Close', 'alt');
    if (k === 'po') {
      if (r.status === 'draft') h += b('save', 'Save') + (can && !S.ed.isNew ? b('approve', 'Approve') : '') + (!S.ed.isNew ? b('del', 'Delete', 'alt') : '');
      if (r.status === 'approved') h += b('save', 'Save (needs re-approval)', 'alt') + b('send', 'Send to vendor') + b('work', r.work_status === 'complete' ? 'Reopen work' : 'Mark work complete', 'alt') + b('void', 'Void', 'alt');
      if (r.status === 'void') h += '<span class="dk-m">Void: counts nowhere.</span>';
    }
    if (k === 'co') {
      if (r.status === 'draft') h += b('save', 'Save') + b('send', 'Send to client for approval') + (!S.ed.isNew ? (can ? b('manual', 'Approve for client…', 'alt') : '') + b('del', 'Delete', 'alt') : '');
      if (r.status === 'pending') h += b('recall', 'Edit (cancels the sent link)', 'alt') + (can ? b('manual', 'Approve for client…', 'alt') : '') + b('void', 'Void', 'alt');
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
    else if (t.hasAttribute('data-subs')) ed.rec.subs = t.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    else if (t.dataset.poid) { var ids = ed.rec.po_ids || []; ed.rec.po_ids = t.checked ? ids.concat(t.dataset.poid) : ids.filter(function (x) { return x !== t.dataset.poid; }); }
    else if (t.dataset.sg) { var q = t.dataset.sg.split(':'); ed.rec.signers_planned[+q[0]][q[1]] = t.value; }
  }
  function sectionsOf(r) {
    var t = r._sections != null ? r._sections : (r.sections || []).map(function (x) { return x.title + '\n' + x.body; }).join('\n\n');
    return String(t).split(/\n\s*\n/).map(function (b) { var l = b.split('\n'); return { title: (l.shift() || '').trim(), body: l.join('\n').trim() }; }).filter(function (x) { return x.title || x.body; });
  }
  function payload() {
    var ed = S.ed, r = ed.rec, b = { job: S.job.id, id: ed.isNew ? undefined : r.id, title: r.title, lines: r.lines, notes_internal: r.notes_internal };
    if (ed.kind === 'po') Object.assign(b, { vendor: r.vendor, materials_only: r.materials_only, due_date: r.due_date, completion_date: r.completion_date, plans_url: r.plans_url, ref_po: r.ref_po, ref_co: r.ref_co, scope: r.scope, variance: r.variance, notes_vendor: r.notes_vendor });
    if (ed.kind === 'co') Object.assign(b, { description: r.description, days_impact: r.days_impact, approval_deadline: r.approval_deadline, notes_client: r.notes_client, notes_vendor: r.notes_vendor, terms: r.terms, subs: r.subs, po_ids: r.po_ids, sections: sectionsOf(r), payment_effect: r.payment_effect, payment_text: r.payment_text, invoice_on_approval: r.invoice_on_approval, plans_url: r.plans_url, signers: (r.signers_planned || []).filter(function (s) { return s.name || s.email; }) });
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


  // ---------- batch 2: attachments, lien waivers, payments, credit memos, deposits, RFIs
  function fileB64(f) {
    if (/^image\//.test(f.type)) return shrink(f).then(function (b) { return { mime: 'image/jpeg', data: b, name: f.name.replace(/\.[^.]+$/, '') + '.jpg' }; });
    return new Promise(function (ok, no) { var rd = new FileReader(); rd.onload = function () { ok({ mime: f.type, data: String(rd.result).split(',')[1] || '', name: f.name }); }; rd.onerror = function () { no(new Error('Could not read that file.')); }; rd.readAsDataURL(f); });
  }
  function attachBox(r, k) {
    var at = r.attachments || [];
    return '<h4>Attachments</h4>' + (at.length ? '<ul class="bf-hist">' + at.map(function (a) { return '<li><button class="link" type="button" data-bf-fdl="' + esc(a.id) + '">' + esc(a.name) + '</button> ' + (a.stage ? '<span class="dk-m">' + (a.stage === 'pre' ? 'before work' : 'after work') + '</span> ' : '') + '<span class="dk-m">' + Math.max(1, Math.round((a.size || 0) / 1024)) + ' KB · ' + esc(a.by || '') + '</span> <button class="link" type="button" data-bf-fdel="' + esc(a.id) + '">Remove</button></li>'; }).join('') + '</ul>' : '<p class="dk-empty">No files yet.</p>') +
      '<div class="bf-bar">' + (k === 'po' ? '<select data-bf-stage><option value="">Attach as…</option><option value="pre">Before work</option><option value="post">After work</option></select>' : '') + '<label class="bf-btn alt bf-file">Attach photo or file<input type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" multiple hidden data-bf-att></label><span class="dk-m">Photos are shrunk to fit. Files up to about 2 MB.</span></div>';
  }
  function waiverBox(r) {
    var w = r.waivers || [], nm = { conditional: 'Conditional', unconditional: 'Unconditional', progress: 'progress', final: 'final' };
    return '<h4>Lien waivers</h4>' + (w.length ? '<div class="tw"><table class="bt"><thead><tr><th>Type</th><th>Through</th><th class="r">Amount</th><th>Status</th><th></th></tr></thead><tbody>' + w.map(function (x) { return '<tr><td>' + nm[x.type] + ' ' + nm[x.stage] + '</td><td>' + fdate(x.through_date) + '</td><td class="r">' + money(x.amount) + '</td><td>' + badge(x.status === 'received' ? 'Approved' : x.status === 'not_needed' ? 'Void' : 'Draft').replace(/>[^<]*</, '>' + (x.status === 'received' ? 'Received' : x.status === 'not_needed' ? 'Not needed' : 'Requested') + '<') + '</td><td>' +
      (x.file_id ? '<button class="link" type="button" data-bf-fdl="' + esc(x.file_id) + '">View</button> ' : '<label class="bf-file link">Upload<input type="file" accept=".pdf,image/*" hidden data-bf-att data-waiver="' + esc(x.id) + '"></label> ') +
      (x.status === 'requested' ? '<button class="link" type="button" data-bf-wa="waiver_update:' + esc(x.id) + ':received">Mark received</button> ' : '') + '<button class="link" type="button" data-bf-wa="waiver_delete:' + esc(x.id) + '">Remove</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="dk-empty">None requested.</p>') +
      '<form class="bf-form bf-inline" data-bf-waiver><select name="type"><option value="conditional">Conditional</option><option value="unconditional">Unconditional</option></select><select name="stage"><option value="progress">Progress</option><option value="final">Final</option></select><input name="amount" inputmode="decimal" placeholder="Amount"><input name="through_date" type="date"><button class="bf-btn alt" type="submit">Request waiver</button></form>';
  }
  function dlFile(id) {
    call('GET', 'file/get?job=' + encodeURIComponent(S.job.id) + '&id=' + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) return flash(r.error, true);
      var bin = atob(r.data), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([u8], { type: r.mime })), a = document.createElement('a'); a.href = url; a.download = r.name; if (/^(image|application\/pdf)/.test(r.mime)) { a.target = '_blank'; a.removeAttribute('download'); } document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    });
  }
  function attachFiles(files, waiverId, stage) {
    var ed = S.ed; if (!ed) return; var list = [].slice.call(files); flash('Attaching…');
    return list.reduce(function (p, f) {
      return p.then(function () { return fileB64(f).then(function (x) { return call('POST', 'file/upload', { job: S.job.id, kind: ed.kind, id: ed.rec.id, name: x.name, mime: x.mime, data: x.data, stage: stage || '', waiver_id: waiverId || undefined }); }).then(function (r) { if (!r.ok) { flash(r.error, true); return; } ed.rec.attachments = r.attachments; if (r.waivers) ed.rec.waivers = r.waivers; }).catch(function (e) { flash(e.message, true); }); });
    }, Promise.resolve()).then(function () { flash('Attached.'); drawEditor(); load(); });
  }
  function pill(t) { return '<span class="bf-st">' + esc(t) + '</span>'; }
  function payTab() {
    var p = S.pays; if (!p) return '<p class="dk-empty">Loading…</p>';
    return '<div class="big">' + kpi('Payments received', money(p.total_payments)) + kpi('Credits applied', money(p.total_credits)) + kpi('Deposits held', money(p.deposits_held)) + '</div>' + (p.rows.length ? '<div class="tw"><table class="bt"><thead><tr><th>Date</th><th>Type</th><th>For</th><th>Method</th><th>Ref</th><th class="r">Amount</th></tr></thead><tbody>' + p.rows.map(function (x) { return '<tr><td>' + fdate(x.date) + '</td><td>' + esc(x.type) + '</td><td>' + esc((x.ref_number || '') + ' ' + (x.title || '')) + '</td><td>' + esc(x.method || '') + '</td><td>' + esc(x.ref || '') + '</td><td class="r">' + money(x.amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="dk-empty">No payments yet. Record them on an invoice.</p>');
  }
  function invSelect(d) { return '<select name="inv_id" required><option value="">Apply to invoice…</option>' + d.invoices.filter(function (i) { return i.status !== 'draft' && i.status !== 'void' && i.totals.balance > 0.004; }).map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.number + ' ' + i.title + ' (' + money(i.totals.balance) + ' due)') + '</option>'; }).join('') + '</select>'; }
  function cmTab(d) {
    var l = d.cms || [];
    return '<form class="bf-form bf-inline" data-bf-cm><input name="title" placeholder="Credit memo title" required><input name="amount" inputmode="decimal" placeholder="Amount" required><input name="reason" placeholder="Reason"><button class="bf-btn" type="submit">Add credit memo</button></form><p class="dk-m">A credit memo lowers what the client owes. Apply it to a sent invoice.</p>' +
      (l.length ? l.map(function (c) { return '<div class="bf-card"><b>' + esc(c.number + ' ' + c.title) + '</b> ' + pill(c.status === 'void' ? 'Void' : money(c.remaining) + ' left of ' + money(c.amount)) + (c.reason ? '<div class="dk-m">' + esc(c.reason) + '</div>' : '') + (c.applied || []).map(function (a) { return '<div class="dk-m">Applied ' + money(a.amount) + ' to ' + esc(a.inv_number) + ' · <button class="link" data-bf-x2="cm:unapply:' + esc(c.id) + ':' + esc(a.id) + '">Remove</button></div>'; }).join('') + (c.status !== 'void' && c.remaining > 0.004 ? '<form class="bf-form bf-inline" data-bf-apply="cm:' + esc(c.id) + '">' + invSelect(d) + '<input name="amount" inputmode="decimal" value="' + c.remaining + '"><button class="bf-btn alt" type="submit">Apply</button></form>' : '') + (c.status !== 'void' && !(c.applied || []).length ? '<button class="link" data-bf-x2="cm:void:' + esc(c.id) + '">Void</button> <button class="link" data-bf-x2="cm:delete:' + esc(c.id) + '">Delete</button>' : '') + '</div>'; }).join('') : '<p class="dk-empty">No credit memos.</p>');
  }
  function depTab(d) {
    var l = d.deps || [];
    return '<form class="bf-form bf-inline" data-bf-dep><input name="title" placeholder="Deposit (for example Retainer)"><input name="amount" inputmode="decimal" placeholder="Amount" required><input name="method" placeholder="Method (check, wire)"><input name="ref" placeholder="Check # / ref"><button class="bf-btn" type="submit">Record deposit</button></form><p class="dk-m">A deposit is money received before an invoice. Apply it to an invoice and it becomes a payment on it.</p>' +
      (l.length ? l.map(function (c) { return '<div class="bf-card"><b>' + esc(c.number + ' ' + c.title) + '</b> ' + pill(c.status === 'void' ? 'Void' : money(c.remaining) + ' left of ' + money(c.amount)) + '<div class="dk-m">' + fdate(c.date) + (c.method ? ' · ' + esc(c.method) : '') + (c.ref ? ' · ' + esc(c.ref) : '') + '</div>' + (c.applied || []).map(function (a) { return '<div class="dk-m">Applied ' + money(a.amount) + ' to ' + esc(a.inv_number) + ' · <button class="link" data-bf-x2="dep:unapply:' + esc(c.id) + ':' + esc(a.id) + '">Remove</button></div>'; }).join('') + (c.status !== 'void' && c.remaining > 0.004 ? '<form class="bf-form bf-inline" data-bf-apply="dep:' + esc(c.id) + '">' + invSelect(d) + '<input name="amount" inputmode="decimal" value="' + c.remaining + '"><button class="bf-btn alt" type="submit">Apply</button></form>' : '') + (c.status !== 'void' && !(c.applied || []).length ? '<button class="link" data-bf-x2="dep:void:' + esc(c.id) + '">Void</button> <button class="link" data-bf-x2="dep:delete:' + esc(c.id) + '">Delete</button>' : '') + '</div>'; }).join('') : '<p class="dk-empty">No deposits.</p>');
  }
  function rfiTab(d) {
    var l = d.rfis || [];
    return '<form class="bf-form bf-inline" data-bf-rfi><input name="title" placeholder="RFI title" required><input name="to" placeholder="Ask who"><input name="question" placeholder="Question" required><input name="due_date" type="date"><button class="bf-btn" type="submit">Add RFI</button></form>' +
      (l.length ? l.map(function (x) { return '<div class="bf-card"><b>' + esc(x.number + ' ' + x.title) + '</b> ' + pill(x.status) + '<div class="dk-m">' + (x.to ? 'To ' + esc(x.to) + ' · ' : '') + (x.due_date ? 'due ' + fdate(x.due_date) : '') + '</div><div>' + esc(x.question) + '</div>' + (x.answer ? '<div class="dk-m">Answer: ' + esc(x.answer) + '</div>' : '') + (x.status === 'open' ? '<form class="bf-form bf-inline" data-bf-rfians="' + esc(x.id) + '"><input name="answer" placeholder="Answer" required><button class="bf-btn alt" type="submit">Record answer</button></form>' : '') + '<button class="link" data-bf-x2="rfi:' + (x.status === 'closed' ? 'reopen' : 'close') + ':' + esc(x.id) + '">' + (x.status === 'closed' ? 'Reopen' : 'Close') + '</button> <button class="link" data-bf-x2="rfi:delete:' + esc(x.id) + '">Delete</button></div>'; }).join('') : '<p class="dk-empty">No RFIs.</p>');
  }
  function b2Click(t) {
    var b;
    if ((b = t.closest('[data-bf-fdl]'))) { dlFile(b.dataset.bfFdl); return true; }
    if ((b = t.closest('[data-bf-x2]'))) {
      var p = b.dataset.bfX2.split(':'), body = { job: S.job.id, id: p[2], action: p[1] }; if (p[3]) body.applied_id = p[3];
      if ((p[1] === 'delete' || p[1] === 'void') && !confirm((p[1] === 'void' ? 'Void' : 'Delete') + ' this?')) return true;
      call('POST', p[0] + '/act', body).then(function (r) { if (!r.ok) return flash(r.error, true); flash('Done.'); load(); }); return true;
    }
    if (S.ed && (b = t.closest('[data-bf-fdel]'))) { if (!confirm('Remove this file?')) return true; call('POST', 'file/delete', { job: S.job.id, kind: S.ed.kind, id: S.ed.rec.id, file_id: b.dataset.bfFdel }).then(function (r) { if (!r.ok) return flash(r.error, true); S.ed.rec.attachments = r.attachments; if (r.waivers) S.ed.rec.waivers = r.waivers; drawEditor(); load(); }); return true; }
    if (S.ed && (b = t.closest('[data-bf-wa]'))) { var q = b.dataset.bfWa.split(':'); call('POST', 'po/act', { job: S.job.id, id: S.ed.rec.id, action: q[0], waiver_id: q[1], status: q[2] }).then(function (r) { if (!r.ok) return flash(r.error, true); S.ed.rec.waivers = r.po.waivers; S.ed.rec.events = r.po.events; drawEditor(); load(); }); return true; }
    return false;
  }
  function b2Submit(f, e) {
    var job = S.job.id, done = function (m) { return function (r) { if (!r.ok) return flash(r.error, true); flash(m); load(); }; };
    if (f.hasAttribute('data-bf-cm')) { e.preventDefault(); call('POST', 'cm/save', { job: job, title: f.title.value, amount: f.amount.value, reason: f.reason.value }).then(done('Credit memo added.')); return true; }
    if (f.hasAttribute('data-bf-dep')) { e.preventDefault(); call('POST', 'dep/save', { job: job, title: f.title.value, amount: f.amount.value, method: f.method.value, ref: f.ref.value }).then(done('Deposit recorded.')); return true; }
    if (f.hasAttribute('data-bf-rfi')) { e.preventDefault(); call('POST', 'rfi/save', { job: job, title: f.title.value, question: f.question.value, to: f.to.value, due_date: f.due_date.value }).then(done('RFI added.')); return true; }
    if (f.hasAttribute('data-bf-rfians')) { e.preventDefault(); call('POST', 'rfi/act', { job: job, id: f.getAttribute('data-bf-rfians'), action: 'answer', answer: f.answer.value }).then(done('Answer recorded.')); return true; }
    if (f.hasAttribute('data-bf-apply')) { e.preventDefault(); var p = f.getAttribute('data-bf-apply').split(':'); call('POST', p[0] + '/act', { job: job, id: p[1], action: 'apply', inv_id: f.inv_id.value, amount: f.amount.value }).then(done('Applied.')); return true; }
    if (f.hasAttribute('data-bf-waiver') && S.ed) { e.preventDefault(); call('POST', 'po/act', { job: job, id: S.ed.rec.id, action: 'waiver_add', type: f.type.value, stage: f.stage.value, amount: f.amount.value, through_date: f.through_date.value }).then(function (r) { if (!r.ok) return flash(r.error, true); S.ed.rec.waivers = r.po.waivers; S.ed.rec.events = r.po.events; drawEditor(); load(); }); return true; }
    return false;
  }

  // ---------- events
  function onClick(e) {
    var t = e.target, b;
    if (b2Click(t)) return;
    if ((b = t.closest('[data-bf-tab]'))) { S.tab = b.dataset.bfTab; draw(); return; }
    if ((b = t.closest('[data-bf-new]'))) { openEditor(b.dataset.bfNew); return; }
    if ((b = t.closest('[data-bf-open]'))) { var p = b.dataset.bfOpen.split(':'); S.tab = p[0]; if (p[0] === 'bill') openBill(p[1]); else openEditor(p[0], p[1]); return; }
    if (t.closest('[data-bf-close]')) { closeEditor(); return; }
    if ((b = t.closest('[data-bf-vedit]'))) { S.vEdit = (S.vendors || []).filter(function (v) { return v.id === b.dataset.bfVedit; })[0]; draw(); return; }
    if (t.closest('[data-bf-vcancel]')) { S.vEdit = null; draw(); return; }
    if ((b = t.closest('[data-bf-vdel]'))) { if (confirm('Remove this vendor from your list? Existing purchase orders keep their name.')) call('POST', 'vendor/delete', { id: b.dataset.bfVdel }).then(function () { flash('Vendor removed.'); load(); }); return; }
    if (t.closest('[data-bf-bnew]')) { openBill(); return; }
    if ((b = t.closest('[data-bf-bill]'))) { var q = b.dataset.bfBill.split(':'); call('POST', 'co/act', { job: S.job.id, id: q[1], action: q[0] === 'approve' ? 'billing_approve' : 'billing_dismiss' }).then(function (r) { if (!r.ok) return flash(r.error, true); flash(q[0] === 'approve' ? 'Billing approved.' : 'Dismissed.'); load(); }); return; }
    if (t.closest('[data-bf-isave]')) { var ap = S.el.querySelector('[data-bf-iapp]').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), qb = S.el.querySelector('[data-bf-iqb]').checked; call('POST', 'cfg/invoicing', { approvers: ap, qb_enabled: qb }).then(function (r) { if (!r.ok) return flash(r.error, true); S.cfg.settings.invoice_approvers = r.approvers; S.cfg.settings.qbo.enabled = r.qb_enabled; flash('Saved.'); }); return; }
    if (t.closest('[data-bf-draws]')) { openDraws(); return; }
    if (t.closest('[data-bf-qb]')) { call('GET', 'qb-export?job=' + encodeURIComponent(S.job.id)).then(function (r) { openText('QuickBooks-ready invoices', r.ok ? JSON.stringify(r.invoices, null, 2) : r.error, 'Not sent to QuickBooks. This is the shape a later sync will use. ' + r.invoices.length + ' invoice(s).'); }); return; }
    if (!S.ed) return;
    if ((b = t.closest('[data-bf-addline]'))) { var ty = b.dataset.bfAddline, nl = blankLine(S.ed.kind); if (ty) { nl.type = ty; nl.desc = { group: 'Group: ', allowance: 'Allowance: ', flat: 'Flat fee: ' }[ty]; if (ty === 'group') { nl.unit_cost = 0; nl.qty = 0; } } S.ed.rec.lines.push(nl); drawEditor(); return; }
    if (t.closest('[data-bf-sectpl]')) { S.ed.rec._sections = ['Summary', 'Scope of work', 'Included work', 'Contract price', 'Progress billing', 'Assumptions and exclusions', 'Schedule and warranty', 'Acceptance'].join('\n\n'); drawEditor(); return; }
    if (t.closest('[data-bf-preview]')) { var pr = S.ed.rec, pc = calc('co', pr); openText('Client preview (what the client sees)', (pr.number || 'New change order') + ' · ' + (pr.title || '') + '\n\n' + (pr.description || '') + '\n\n' + (pr.lines || []).filter(function (l) { return l.desc || n2(l.unit_cost); }).map(function (l, i) { return l.desc + '  ' + money(pc.lt[i] || 0); }).join('\n') + '\n\nTotal ' + money(pc.price) + '\nSchedule: ' + (n2(pr.days_impact) ? 'adds ' + n2(pr.days_impact) + ' working day(s)' : 'no change to the completion date') + '\nBilling: ' + ({ billed_with_next_progress: 'with the next progress payment', billed_on_approval: 'when approved', custom: pr.payment_text }[pr.payment_effect] || '(not chosen yet)') + (pr.approval_deadline ? '\nPlease respond by ' + fdate(pr.approval_deadline) : '') + '\n\n' + (pr.terms || ''), 'This is a text preview. The real page also shows your logo, license and the approval box.'); return; }
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
    if (a === 'work') return actCall('po', 'work', { complete: r.work_status !== 'complete' }).then(function (res) { if (res) afterAct(res, res.po.work_status === 'complete' ? 'Work marked complete.' : 'Work reopened.'); });
    if (a === 'bill_delete' || a === 'payment_delete') { var x = {}; x[btn.dataset.idf] = btn.dataset.idv; return actCall(k, a, x).then(function (res) { if (res) afterAct(res, 'Removed.'); }); }
    if (a === 'send') { return save().then(function (rec) { if (rec) startSend(k); }); }
    if (a === 'confirm-send') return actCall(k, 'send').then(function (res) { if (res) afterAct(res, res.mail && res.mail.delivered ? 'Sent' + (res.mail.mode !== 'live' ? ' in test mode: the email went only to Michael, not the real recipient.' : '.') : 'Link ready. The email service is not connected yet, so nothing was emailed. Copy the link below to send it yourself.'); });
    if (a === 'approve') return save().then(function (rec) { if (rec) actCall('po', 'approve').then(function (res) { if (res) afterAct(res, 'Approved. It now counts as a committed cost.'); }); });
    if (a === 'void') { if (!confirm('Void this ' + (k === 'po' ? 'purchase order' : k === 'co' ? 'change order' : 'invoice') + '? It stops counting everywhere.')) return; return actCall(k, 'void').then(function (res) { if (res) afterAct(res, 'Voided.'); }); }
    if (a === 'contract') { return call('GET', 'co/contract?job=' + encodeURIComponent(S.job.id) + '&id=' + encodeURIComponent(S.ed.rec.id)).then(function (res) { if (!res.ok) return flash(res.error || 'Could not open the contract', true); var m = document.createElement('div'); m.className = 'bf-modal bf-contract'; document.documentElement.classList.add('bf-lock'); m.innerHTML = '<div class="bf-panel"><div class="bf-head"><b>Contract preview</b><button class="bf-x big" data-bf-close2>×</button></div><div class="bf-body bf-cbody"><iframe class="bf-cframe" title="Contract preview"></iframe></div></div>'; m.querySelector('iframe').srcdoc = res.html; m.addEventListener('click', function (e) { if (e.target.closest('[data-bf-close2]')) { m.remove(); if (!S.ed) document.documentElement.classList.remove('bf-lock'); } }); S.el.appendChild(m); }); }
    if (a === 'finish') { if (!confirm('Make an editable BuildFlow copy of this change order? The imported one stays on file, marked as replaced.')) return; return actCall('co', 'finish').then(function (res) { if (!res) return; flash('Copy ' + res.co.number + ' created. Fill in the rest, preview the contract, then send.'); closeEditor(); S.tab = 'co'; load().then(function () { openEditor('co', res.co.id); }); }); }
    if (a === 'recall') return actCall(k, 'recall').then(function (res) { if (res) afterAct(res, 'The sent link no longer works. Edit it, then send it again.'); });
    if (a === 'del') { if (!confirm('Delete this draft?')) return; return actCall(k, 'delete').then(function (res) { if (res) afterAct(res, 'Deleted.'); }); }
    if (a === 'manual') { var note = prompt('How did the client approve? (for example: signed paper copy, or email on Nov 22)'); if (!note) return; return actCall('co', 'manual_approve', { note: note }).then(function (res) { if (res) afterAct(res, 'Approved for the client. Price and budget updated.'); }); }
  }
  function onSubmit(e) {
    var f = e.target;
    if (b2Submit(f, e)) return;
    if (f.hasAttribute('data-bf-client')) {
      e.preventDefault(); var sg = [0, 1].map(function (i) { return { name: f['n' + i].value.trim(), email: f['e' + i].value.trim() }; }).filter(function (s) { return s.name || s.email; });
      call('POST', 'job/setup', { job: S.job.id, client: { name: sg[0] ? sg[0].name : '', email: sg[0] ? sg[0].email : '', signers: sg } }).then(function (r) { if (!r.ok) return flash(r.error, true); flash('Saved.'); load(); }); return;
    }
    if (f.hasAttribute('data-bf-vendor')) {
      e.preventDefault(); var vb = {}; ['id', 'name', 'trade', 'email', 'phone', 'insurance_expires', 'workers_comp_expires', 'payment_method', 'trade_agreement', 'notes'].forEach(function (n) { vb[n] = f[n].value.trim(); }); vb.w9_on_file = f.w9_on_file.checked; vb.contacts = f.contacts.value.split('\n').map(function (l) { var p = l.split(',').map(function (x) { return x.trim(); }); return { name: p[0] || '', role: p[1] || '', phone: p[2] || '', email: p[3] || '' }; }).filter(function (c) { return c.name || c.phone || c.email; }); if (!vb.id) delete vb.id;
      call('POST', 'vendor/save', vb).then(function (r) { if (!r.ok) return flash(r.error, true); S.vEdit = null; flash('Saved ' + r.vendor.name + '.'); load(); }); return;
    }
    if (f.hasAttribute('data-bf-pay')) {
      e.preventDefault(); var kind = f.getAttribute('data-bf-pay'), body = { amount: f.amount.value, date: f.date.value, method: f.method.value, ref: f.ref.value };
      actCall(S.ed.kind, kind, body).then(function (res) { if (res) afterAct(res, (kind === 'bill' ? 'Bill' : 'Payment') + ' recorded.'); }); return;
    }
    if (f.hasAttribute('data-bf-comment')) { e.preventDefault(); var ed2 = S.ed; call('POST', 'comment/add', { job: S.job.id, kind: ed2.kind, id: ed2.rec.id, text: f.text.value }).then(function (r) { if (!r.ok) return flash(r.error, true); ed2.rec.comments = r.comments; drawEditor(); }); return; }
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
        call('POST', 'draw/save', { job: S.job.id, draws: draws }).then(function () { return call('POST', 'draw/draft', { job: S.job.id, draw_id: x.id }); }).then(function (r) {
          if (!r.ok) return flash(r.error, true);
          flash('Draft invoice ' + r.invoice.number + ' created' + (r.includes_cos ? ' with ' + r.includes_cos + ' change order(s)' : '') + '. Review it, then send.'); m.remove(); document.documentElement.classList.remove('bf-lock'); S.tab = 'inv'; load().then(function () { openEditor('inv', r.invoice.id); });
        });
      }
    });
    S.el.appendChild(m);
  }

  var bound = new WeakSet();
  function bind(el) {
    if (bound.has(el)) return; bound.add(el);
    el.addEventListener('change', function (e) { var t = e.target; if (t && t.hasAttribute && t.hasAttribute('data-bf-rcpt') && t.files && t.files.length) { var fs = t.files; uploadReceipts(fs).then(function () { t.value = ''; }); } }); el.addEventListener('click', onClick); el.addEventListener('submit', onSubmit);
    el.addEventListener('change', function (e) { var t = e.target; if (t && t.hasAttribute && t.hasAttribute('data-bf-att') && t.files && t.files.length) { var st = t.closest('.bf-body') && t.closest('.bf-body').querySelector('[data-bf-stage]'); attachFiles(t.files, t.dataset.waiver, st ? st.value : ''); } });
    el.addEventListener('input', function (e) { if (!S.ed || !e.target.closest('.bf-modal')) return; syncField(e.target); if (e.target.dataset.f === 'mode') drawEditor(); else refreshTotals(); });
    el.addEventListener('change', function (e) { if (!S.ed || !e.target.closest('.bf-modal')) return; syncField(e.target); if (e.target.dataset.f === 'vendor.name') { var vm = (S.vendors || []).filter(function (x) { return x.name.toLowerCase() === e.target.value.toLowerCase(); })[0]; if (vm && !S.ed.rec.vendor.email) { S.ed.rec.vendor.email = vm.email; drawEditor(); return; } } if (e.target.dataset.f === 'mode') drawEditor(); else refreshTotals(); });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.ed) closeEditor(); if (e.key === 'Enter' && e.target.matches('tr[data-bf-open]')) e.target.click(); });
  }

  window.BFFinance = {
    // opts: { api, key, job:{id,name,client}, snap:{f,pos,cos,inv,budget} }
    mount: function (el, opts) {
      var sameJob = !!(S.job && S.job.id === opts.job.id);
      S.single = !!opts.tab; if (opts.tab) S.tab = opts.tab;
      S.api = String(opts.api || '').replace(/\/$/, ''); S.key = opts.key; S.job = opts.job; S.snap = opts.snap || null; S.el = el; bind(el);
      if (sameJob && S.data) { draw(); return; }
      if (!sameJob) { S.tab = opts.tab || 'overview'; S.ed = null; S.data = null; S.note = ''; }
      draw();
      var jobId = S.job.id;
      (S.cfg ? Promise.resolve() : call('GET', 'config').then(function (c) { if (!c.ok) { S.err = c.error === 'not signed in' ? 'The finance tools are not turned on for this link yet.' : c.error; return; } S.cfg = c; }))
        .then(function () { if (S.err || S.job.id !== jobId) return; return load(); })
        .then(function () { if (S.data && S.job.id === jobId) return maybeImport(); });
    }
  };
})();
