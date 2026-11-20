/* BuildFlowAI voice recorder: one shared piece for the request form, the Chat tab, and anything else.
 *
 *   <script src="/voice/recorder.js"></script>
 *   var rec = BuildFlowVoice.mount(document.getElementById('somewhere'), {
 *     notice: 'Just so everyone knows, this conversation is being recorded for project notes.', // spoken out loud first
 *     maxBytes: 34 * 1024 * 1024,            // stops on its own before one send gets too big
 *     storeKey: 'form',                      // separate saved-on-phone slot per place it is used ('chat', ...)
 *     onChange: function (state, rec) {}     // 'idle' | 'announce' | 'rec' | 'paused' | 'stopping' | 'done'
 *   });
 *   rec.busy()   -> true while announcing / recording / saving
 *   rec.clip()   -> null, or { blob, mime, name, ms, log, notice, gaps, file() -> Promise<{name,type,data(base64)}> }
 *   rec.sent()   -> call after a successful send: clears the copy saved on the phone
 *   rec.reset()  -> throw it away and go back to the Start button
 *
 * Legal (California, all-party consent; Michael 2026-11-19): the phone SAYS the notice out loud before the mic turns on
 * (on iPhone the speaker goes quiet once the mic is on, so the order matters), shows it on screen too, and the time and
 * how it was given go into clip().log, which is sent with every recording. If the phone cannot speak, the person must
 * say it and tap Start. Pieces are saved on the phone every 5 seconds, so a dropped signal or a closed app does not
 * lose the recording; a leftover recording is offered back next time.
 *
 * Styling uses the app's CSS variables (--card, --line, --ink, --muted, --accent, --bg) with fallbacks.
 */
(function (global) {
  'use strict';
  var DEFAULT_NOTICE = 'Just so everyone knows, this conversation is being recorded for project notes.';
  var css = [
    '.bfv{background:var(--card,#1F2226);border:1.5px solid var(--line,#33373D);border-radius:18px;padding:18px;color:var(--ink,#F1EEE6)}',
    '.bfv-mic{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;min-height:64px;background:var(--accent,#B4EE3A);color:var(--bg,#16181B);border:0;border-radius:16px;font:inherit;font-size:20px;font-weight:700;cursor:pointer;touch-action:manipulation}',
    '.bfv-mic:active{transform:scale(.98)}.bfv-mic:disabled{opacity:.5}',
    '.bfv-note{color:var(--muted,#A9A79F);font-size:15px;margin:10px 2px 0}',
    '.bfv-warn{color:#FFC46B;font-size:15px;margin:10px 2px 0}',
    '.bfv-notice{font-size:22px;font-weight:600;line-height:1.35;margin:4px 0 14px}',
    '.bfv-notice small{display:block;font-size:15px;font-weight:400;color:var(--muted,#A9A79F);margin-top:8px}',
    '.bfv-live{display:flex;align-items:center;gap:12px;margin-bottom:14px}',
    '.bfv-dot{width:16px;height:16px;border-radius:50%;background:#FF4D3D;flex:0 0 auto;animation:bfvpulse 1.4s ease-in-out infinite}',
    '.bfv.paused .bfv-dot{animation:none;background:var(--muted,#A9A79F)}',
    '@keyframes bfvpulse{50%{opacity:.35}}@media (prefers-reduced-motion:reduce){.bfv-dot{animation:none}}',
    '.bfv-clock{font-size:34px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.5px}',
    '.bfv-state{color:var(--muted,#A9A79F);font-size:15px}',
    '.bfv-meter{height:8px;background:#2B2F34;border-radius:4px;overflow:hidden;margin:0 0 16px}',
    '.bfv-meter i{display:block;height:100%;width:0;background:var(--accent,#B4EE3A);transition:width .08s linear}',
    '.bfv-row{display:flex;gap:10px}',
    '.bfv-row button{flex:1;min-height:56px;border-radius:14px;font:inherit;font-size:18px;font-weight:600;cursor:pointer;touch-action:manipulation}',
    '.bfv-b2{background:none;border:1.5px solid var(--line,#33373D);color:var(--ink,#F1EEE6)}',
    '.bfv-stop{background:#FF4D3D;border:0;color:#fff}',
    '.bfv audio{width:100%;margin:4px 0 12px}',
    '.bfv-got{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}',
    '.bfv-got b{font-size:18px}.bfv-got span{color:var(--muted,#A9A79F);font-size:15px}',
    '.bfv-link{background:none;border:0;color:var(--muted,#A9A79F);font:inherit;font-size:15px;text-decoration:underline;cursor:pointer;padding:6px 0}',
    '.bfv [hidden]{display:none!important}'
  ].join('\n');
  var html =
    '<div data-v="idle">' +
      '<button type="button" class="bfv-mic" data-a="start">' +
        '<svg width="22" height="26" viewBox="0 0 22 26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><rect x="6" y="1.5" width="10" height="15" rx="5"/><path d="M2 12a9 9 0 0 0 18 0M11 21v3.5"/></svg>' +
        '<span data-t="startLabel">Start recording</span></button>' +
      '<p class="bfv-note" data-t="hint">First the phone says out loud that it is recording, so everyone knows.</p>' +
      '<p class="bfv-warn" data-t="unsupported" hidden>This browser can’t record. Open the app from your home screen, or in Safari or Chrome.</p>' +
      '<div data-t="recover" hidden><p class="bfv-warn" data-t="recoverMsg"></p>' +
        '<div class="bfv-row"><button type="button" class="bfv-b2" data-a="keep">Use it</button><button type="button" class="bfv-b2" data-a="drop">Delete it</button></div></div>' +
    '</div>' +
    '<div data-v="announce" hidden>' +
      '<p class="bfv-notice" data-t="notice"></p>' +
      '<p class="bfv-state" data-t="announceState">Saying it out loud now...</p>' +
      '<div class="bfv-row" data-t="manual" hidden><button type="button" class="bfv-mic" data-a="manualGo">I told everyone. Start.</button></div>' +
      '<button type="button" class="bfv-link" data-a="cancel">Cancel</button>' +
    '</div>' +
    '<div data-v="live" hidden>' +
      '<div class="bfv-live"><span class="bfv-dot"></span><span class="bfv-clock" data-t="clock">0:00</span><span class="bfv-state" data-t="liveState">Recording</span></div>' +
      '<div class="bfv-meter"><i data-t="meter"></i></div>' +
      '<div class="bfv-row"><button type="button" class="bfv-b2" data-a="pause">Pause</button><button type="button" class="bfv-stop" data-a="stop">Stop</button></div>' +
      '<p class="bfv-note">Keep this screen open while you record.</p>' +
      '<p class="bfv-warn" data-t="liveWarn" hidden></p>' +
    '</div>' +
    '<div data-v="done" hidden>' +
      '<div class="bfv-got"><b data-t="gotLen">Recording</b><span data-t="gotSize"></span></div>' +
      '<audio data-t="player" controls preload="metadata"></audio>' +
      '<button type="button" class="bfv-link" data-a="redo">Delete and record again</button>' +
    '</div>';

  var styled = false;
  function addStyle() {
    if (styled) return; styled = true;
    var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }
  var fmt = function (ms) { var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; s = s % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; };
  var clockStr = function (d) { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }); };
  var ext = function (t) { return /mp4|m4a|aac/.test(t) ? 'm4a' : /ogg/.test(t) ? 'ogg' : 'webm'; };
  var pad = function (n) { return ('0' + n).slice(-2); };
  function b64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1]); }; fr.onerror = rej; fr.readAsDataURL(blob);
    });
  }

  // --- saved pieces on the phone (IndexedDB), one slot per storeKey ---
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('abf_voice', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('meta'); r.result.createObjectStore('chunks'); };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function idb(store, mode, fn) {
    return db().then(function (d) { return new Promise(function (res, rej) {
      var tx = d.transaction(store, mode), out = fn(tx.objectStore(store));
      tx.oncomplete = function () { res(out && out.result); }; tx.onerror = function () { rej(tx.error); };
    }); }).catch(function () {});
  }

  function mount(root, opts) {
    opts = opts || {};
    addStyle();
    var NOTICE = opts.notice || DEFAULT_NOTICE;
    var MAX = opts.maxBytes || 34 * 1024 * 1024;
    var SLOT = 'current' + (opts.storeKey && opts.storeKey !== 'form' ? '-' + opts.storeKey : '');
    root.classList.add('bfv'); root.innerHTML = html;
    var q = function (k) { return root.querySelector('[data-t="' + k + '"]'); };
    var btn = function (k) { return root.querySelector('[data-a="' + k + '"]'); };
    var views = root.querySelectorAll('[data-v]');
    if (opts.startLabel) q('startLabel').textContent = opts.startLabel;

    var st = 'idle', mr = null, stream = null, chunks = [], mime = '', startAt = 0, elapsed = 0, runFrom = 0, tick = null;
    var notice = null, blob = null, recId = '', seq = 0, lock = null, ac = null, raf = 0, hiddenAt = 0, gaps = [];
    var api;
    function set(s) { st = s; if (opts.onChange) try { opts.onChange(s, api); } catch (e) {} }
    function show(v) { Array.prototype.forEach.call(views, function (x) { x.hidden = x.getAttribute('data-v') !== v; }); }

    var canRec = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && global.MediaRecorder);
    if (!canRec) { btn('start').disabled = true; q('unsupported').hidden = false; }

    function saveMeta() { return idb('meta', 'readwrite', function (s) { return s.put({ id: recId, mime: mime, startAt: startAt, notice: notice, elapsed: elapsed, gaps: gaps }, SLOT); }); }
    function clearSaved() {
      var id = recId;
      idb('meta', 'readwrite', function (s) { s.delete(SLOT); });
      if (id) idb('chunks', 'readwrite', function (s) { s.delete(IDBKeyRange.bound(id + '-', id + '-￿')); });
    }
    function loadSaved() {
      return idb('meta', 'readonly', function (s) { return s.get(SLOT); }).then(function (m) {
        if (!m || !m.id) return null;
        return idb('chunks', 'readonly', function (s) { return s.getAll(IDBKeyRange.bound(m.id + '-', m.id + '-￿')); }).then(function (all) {
          all = (all || []).sort(function (a, b) { return a.seq - b.seq; });
          return all.length ? { meta: m, blob: new Blob(all.map(function (c) { return c.b; }), { type: m.mime }) } : null;
        });
      });
    }

    // 1. say it out loud
    function announce() {
      var n = q('notice'); n.textContent = '“' + NOTICE + '”';
      var sm = document.createElement('small'); sm.textContent = 'Show this screen too if anyone did not hear it.'; n.appendChild(sm);
      q('announceState').textContent = 'Saying it out loud now...'; q('manual').hidden = true;
      show('announce'); set('announce');
      var spoke = false, finished = false;
      var go = function (how) { if (finished || st !== 'announce') return; finished = true; notice = { at: new Date().toISOString(), how: how }; start(); };
      var manual = function () { if (finished) return;
        q('announceState').textContent = 'The phone could not say it. Please say it out loud yourself, then tap Start.'; q('manual').hidden = false; };
      btn('manualGo').onclick = function () { go('said by the person recording (phone voice unavailable)'); };
      if (!global.speechSynthesis || !global.SpeechSynthesisUtterance) return manual();
      try {
        speechSynthesis.cancel();
        var u = new SpeechSynthesisUtterance(NOTICE); u.rate = 0.95; u.volume = 1; u.lang = 'en-US';
        u.onstart = function () { spoke = true; };
        u.onend = function () { if (spoke) go('spoken out loud by the phone'); else manual(); };
        u.onerror = manual;
        speechSynthesis.speak(u);
        setTimeout(function () { if (!spoke) manual(); }, 3000);
        setTimeout(function () { if (spoke && !finished) go('spoken out loud by the phone'); }, 12000);
      } catch (e) { manual(); }
    }

    // 2. record
    function pickMime() {
      var c = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
      for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c[i])) return c[i];
      return '';
    }
    function start() {
      navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } })
      .then(function (s) {
        if (st !== 'announce') { s.getTracks().forEach(function (t) { t.stop(); }); return; }
        stream = s; mime = pickMime();
        var o = { audioBitsPerSecond: 48000 }; if (mime) o.mimeType = mime;
        try { mr = new MediaRecorder(s, o); } catch (e) { mr = new MediaRecorder(s); }
        mime = (mr.mimeType || mime || 'audio/webm').split(';')[0];
        chunks = []; seq = 0; gaps = []; elapsed = 0; startAt = Date.now(); runFrom = startAt; recId = 'r' + startAt;
        mr.ondataavailable = function (e) {
          if (!e.data || !e.data.size) return;
          chunks.push(e.data);
          var item = { id: recId, seq: seq++, b: e.data };
          idb('chunks', 'readwrite', function (s2) { s2.put(item, recId + '-' + ('00000' + item.seq).slice(-6)); });
        };
        mr.onstop = finish;
        mr.start(5000);
        set('rec'); saveMeta(); show('live'); root.classList.remove('paused');
        btn('pause').textContent = 'Pause'; q('liveState').textContent = 'Recording'; q('liveWarn').hidden = true;
        tick = setInterval(draw, 250); draw(); keepAwake(); meter(s);
      }).catch(function () {
        set('idle'); show('idle');
        q('unsupported').textContent = 'The microphone is blocked. Allow the microphone for this app in Settings, then try again.';
        q('unsupported').hidden = false;
      });
    }
    function now() { return elapsed + (st === 'rec' ? Date.now() - runFrom : 0); }
    function draw() {
      q('clock').textContent = fmt(now());
      var bytes = chunks.reduce(function (n, c) { return n + c.size; }, 0);
      if (bytes > MAX * 0.9 && st === 'rec') { q('liveWarn').textContent = 'This recording is almost as long as one send can carry. It will stop on its own soon.'; q('liveWarn').hidden = false; }
      if (bytes > MAX * 0.97 && st === 'rec') stop();
    }
    function meter(s) {
      try {
        var A = global.AudioContext || global.webkitAudioContext; if (!A) return;
        if (!ac) ac = new A(); if (ac.resume) ac.resume();
        var an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(s).connect(an);
        var buf = new Uint8Array(an.fftSize), bar = q('meter');
        (function loop() {
          an.getByteTimeDomainData(buf); var peak = 0;
          for (var i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          bar.style.width = (st === 'rec' ? Math.min(100, peak / 64 * 100) : 0) + '%';
          raf = requestAnimationFrame(loop);
        })();
      } catch (e) {}
    }
    function keepAwake() {
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { lock = l; }).catch(function () {}); } catch (e) {}
    }
    document.addEventListener('visibilitychange', function () {
      if (st !== 'rec' && st !== 'paused') return;
      if (document.hidden) { hiddenAt = Date.now(); return; }
      keepAwake();
      if (hiddenAt && Date.now() - hiddenAt > 3000) {
        gaps.push(clockStr(new Date(hiddenAt)) + ' to ' + clockStr(new Date())); saveMeta();
        q('liveWarn').textContent = 'The app was closed or the screen went off for a bit. Some of that time may be missing.'; q('liveWarn').hidden = false;
      }
      hiddenAt = 0;
    });
    function pause() {
      if (st === 'rec') { try { mr.pause(); } catch (e) { return; } elapsed += Date.now() - runFrom; set('paused');
        root.classList.add('paused'); btn('pause').textContent = 'Resume'; q('liveState').textContent = 'Paused'; }
      else if (st === 'paused') { try { mr.resume(); } catch (e) { return; } runFrom = Date.now(); set('rec');
        root.classList.remove('paused'); btn('pause').textContent = 'Pause'; q('liveState').textContent = 'Recording'; }
      saveMeta();
    }
    function stop() {
      if (st !== 'rec' && st !== 'paused') return;
      if (st === 'rec') elapsed += Date.now() - runFrom;
      set('stopping'); q('liveState').textContent = 'Saving...';
      try { mr.stop(); } catch (e) { finish(); }
    }
    function release() {
      clearInterval(tick); cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null;
      if (ac) { try { ac.close(); } catch (e) {} ac = null; }
      if (lock) { try { lock.release(); } catch (e) {} lock = null; }
    }
    function finish() { release(); saveMeta(); blob = new Blob(chunks, { type: mime }); ready(); set('done'); }
    function ready() {
      q('player').src = URL.createObjectURL(blob);
      q('gotLen').textContent = elapsed ? 'Recording, ' + fmt(elapsed) : 'Recording';
      q('gotSize').textContent = blob.size < 1048576 ? Math.max(1, Math.round(blob.size / 1024)) + ' KB' : (blob.size / 1048576).toFixed(1) + ' MB';
      show('done');
    }
    function reset() {
      if (st === 'rec' || st === 'paused') { mr.onstop = null; try { mr.stop(); } catch (e) {} }
      try { speechSynthesis.cancel(); } catch (e) {}
      release(); clearSaved(); blob = null; notice = null; chunks = []; elapsed = 0; recId = '';
      q('player').removeAttribute('src'); show('idle'); set('idle');
    }

    btn('start').onclick = function () {
      q('unsupported').hidden = true; q('recover').hidden = true;
      // iPhones only allow sound meters started from a tap, so make it now
      try { var A = global.AudioContext || global.webkitAudioContext; if (A && !ac) { ac = new A(); ac.resume(); } } catch (e) {}
      announce();
    };
    btn('cancel').onclick = reset;
    btn('pause').onclick = pause;
    btn('stop').onclick = stop;
    btn('redo').onclick = reset;

    // A recording left on this phone from before (app closed, no signal, etc.)
    if (canRec) loadSaved().then(function (s) {
      if (!s || st !== 'idle') return;
      var m = s.meta;
      q('recoverMsg').textContent = 'You have a recording from ' +
        new Date(m.startAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) + ' that was not sent.';
      q('recover').hidden = false;
      btn('keep').onclick = function () {
        blob = s.blob; mime = m.mime; startAt = m.startAt; notice = m.notice; gaps = m.gaps || []; recId = m.id; elapsed = m.elapsed || 0;
        q('recover').hidden = true; ready();
        if (!elapsed) q('player').onloadedmetadata = function () {
          if (isFinite(this.duration)) { elapsed = this.duration * 1000; q('gotLen').textContent = 'Recording, ' + fmt(elapsed); } };
        set('done');
      };
      btn('drop').onclick = function () { recId = m.id; clearSaved(); recId = ''; q('recover').hidden = true; };
    });

    api = {
      state: function () { return st; },
      busy: function () { return st === 'rec' || st === 'paused' || st === 'announce' || st === 'stopping'; },
      clip: function () {
        if (st !== 'done' || !blob) return null;
        var d = new Date(startAt);
        var name = 'Voice ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + pad(d.getMinutes()) + '.' + ext(mime);
        var log = 'Recording: ' + fmt(elapsed) + ', started ' + d.toLocaleString() + '.\nRecording notice: "' + NOTICE + '" ' +
          (notice ? notice.how + ' at ' + new Date(notice.at).toLocaleString() + ', before the mic started.' : 'NOT LOGGED.') +
          (gaps.length ? '\nPossible gaps (app closed or screen off): ' + gaps.join('; ') + '.' : '');
        var b = blob;
        return { blob: b, mime: mime, name: name, ms: elapsed, log: log, notice: notice, gaps: gaps.slice(),
          file: function () { return b64(b).then(function (data) { return { name: name, type: mime, data: data }; }); } };
      },
      sent: function () { clearSaved(); blob = null; recId = ''; show('idle'); set('idle'); },
      reset: reset
    };
    return api;
  }

  global.BuildFlowVoice = { mount: mount, NOTICE: DEFAULT_NOTICE, version: '1' };
})(window);
