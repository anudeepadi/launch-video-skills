// Launch Video Kit helpers. Everything is a pure function of t (seconds) so frames are
// reproducible and the renderer can seek anywhere. Use inside SCENE.onFrame(t).
(() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = {
    linear: (p) => p,
    outCubic: (p) => 1 - Math.pow(1 - p, 3),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOutCubic: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    outBack: (p) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    spring: (p) => 1 - Math.exp(-6 * p) * Math.cos(10 * p),
  };
  // progress 0..1 of window [start, start+dur], eased
  const prog = (t, start, dur, e = 'outExpo') => ease[e](clamp((t - start) / dur));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // Typewriter. `html` may contain <span class="tok-k">..</span>; tags are kept intact.
  function type(el, html, t, start, cps = 28, caret = true) {
    const n = Math.max(0, Math.floor((t - start) * cps));
    let out = '', shown = 0, i = 0;
    while (i < html.length && shown < n) {
      if (html[i] === '<') { const j = html.indexOf('>', i); out += html.slice(i, j + 1); i = j + 1; continue; }
      if (html[i] === '&') { const j = html.indexOf(';', i); out += html.slice(i, j + 1); i = j + 1; shown++; continue; }
      out += html[i++]; shown++;
    }
    // close any open spans
    const open = (out.match(/<span/g) || []).length - (out.match(/<\/span>/g) || []).length;
    out += '</span>'.repeat(Math.max(0, open));
    const blink = Math.floor(t * 2) % 2 === 0 || shown < n;
    el.innerHTML = out + (caret && t >= start - 0.5 && blink ? '<span class="caret"></span>' : '');
    return shown >= html.replace(/<[^>]+>/g, '').replace(/&[^;]+;/g, 'x').length;
  }
  // Number counter
  function count(el, t, start, dur, from, to, fmt = (v) => Math.round(v).toLocaleString('en-US')) {
    el.textContent = fmt(lerp(from, to, prog(t, start, dur, 'outCubic')));
  }
  // Split an element's text into word spans for the .words stagger preset
  function words(el) {
    el.classList.add('words');
    el.innerHTML = el.textContent.trim().split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}">${w}</span>`).join(' ');
  }
  // Slow ambient drift for .orb / .bg-grid layers
  function ambient(t) {
    $$('.orb.a').forEach((o) => (o.style.transform = `translate(${Math.sin(t * 0.35) * 120}px, ${Math.cos(t * 0.27) * 90}px)`));
    $$('.orb.b').forEach((o) => (o.style.transform = `translate(${Math.cos(t * 0.3) * 140}px, ${Math.sin(t * 0.22) * 100}px)`));
    $$('.bg-grid').forEach((g) => (g.style.transform = `translateY(${(t * 18) % 80}px)`));
  }
  // Seeded pseudo-random for stable procedural layouts
  const rand = (seed) => { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); };

  // ---------- Narration-driven timeline ----------
  // data-edge="e" pins to the END of the line/word instead of its start.
  // Sections marked data-shot="id" are laid out back to back. Each shot lasts as long as
  // its voice lines (SCENE.voice.lines with shot:id) plus a tail, or data-len, whichever is longer.
  // Inside a shot, --d is shot-local seconds; data-on="key" or data-on="key:word" pins an
  // element's start to a spoken line or word (+ data-off seconds). window.__VOICE (injected by
  // the renderer after TTS) supplies real clip durations and word timestamps; without it,
  // durations are estimated so layout still works for silent previews.
  const L = {}, T = {};
  const estimate = (s, speed = 1) => Math.max(0.6, s.split(/\s+/).length / 2.75 / speed + 0.15);
  const norm = (w) => w.toLowerCase().replace(/[^\w'-]/g, '');
  function at(key, word, edge = 's') {
    const l = L[key];
    if (!l) throw new Error(`unknown voice line "${key}"`);
    if (!word) return edge === 'e' ? l.end : l.start;
    const w = l.words.find((x) => x.w === norm(word));
    if (w) return l.start + (edge === 'e' ? w.e : w.s);
    const txt = (l.line.say || l.line.text || '').toLowerCase(), i = txt.indexOf(norm(word)); // fallback: proportional
    return l.start + (i < 0 ? 0 : (i / txt.length) * l.dur);
  }
  function layout() {
    const S = window.SCENE, V = window.__VOICE || {}, voice = S.voice || {};
    const lines = voice.lines || [], gap = voice.gap ?? 0.12, tail = voice.tail ?? 0.45, xfade = voice.xfade ?? 0.1;
    const shots = $$('[data-shot]');
    let cursor = 0;
    for (const sec of shots) {
      const id = sec.dataset.shot, start = cursor;
      let lastEnd = 0;
      for (const ln of lines.filter((l) => l.shot === id)) {
        const a = ln.at != null ? ln.at : lastEnd + (ln.after ?? (lastEnd ? gap : 0));
        if (ln.pause != null) { lastEnd = a + ln.pause; continue; }
        const v = V[ln.key], dur = v ? v.dur : estimate(ln.say || ln.text, voice.speed || 1);
        L[ln.key] = { start: start + a, end: start + a + dur, dur, words: v ? v.words : [], line: ln, real: !!v };
        lastEnd = a + dur;
      }
      const len = Math.max(parseFloat(sec.dataset.len || 0), lastEnd ? lastEnd + tail : 0);
      T[id] = { start, end: start + len, len };
      cursor = start + len - xfade;
    }
    shots.forEach((sec, i) => {
      const s = T[sec.dataset.shot];
      sec.style.setProperty('--in', s.start + 's');
      sec.style.setProperty('--out', i < shots.length - 1 ? s.end - 0.3 + 's' : '999s');
      for (const el of sec.querySelectorAll('*')) {
        if (el.dataset.d0 == null) el.dataset.d0 = el.style.getPropertyValue('--d') || '';
        let d = null;
        if (el.dataset.on) { const [k, w] = el.dataset.on.split(':'); d = at(k, w, el.dataset.edge || 's') + parseFloat(el.dataset.off || 0); }
        else if (el.dataset.d0) d = s.start + parseFloat(el.dataset.d0);
        if (d != null) el.style.setProperty('--d', d.toFixed(3) + 's');
      }
    });
    const last = T[shots[shots.length - 1].dataset.shot];
    S.duration = +(last.end + (voice.outro ?? 0)).toFixed(3);
    // cues: {on:'key[:word]', t:offset} | {shot:'id', t} | {t} (absolute)
    S.cues = (S.cues || []).map((c) => {
      if (c.on) { const [k, w] = c.on.split(':'); return { ...c, t: +(at(k, w, c.edge || 's') + (c.t || 0)).toFixed(3) }; }
      if (c.shot) return { ...c, t: +(T[c.shot].start + (c.t || 0)).toFixed(3) };
      return c;
    });
    S.narration = Object.entries(L).map(([key, l]) => ({ key, t: +l.start.toFixed(3), gain: l.line.gain ?? 1 }));
    S.timeline = { shots: T, lines: Object.fromEntries(Object.entries(L).map(([k, l]) => [k, { start: +l.start.toFixed(3), end: +l.end.toFixed(3), real: l.real }])) };
    return S;
  }
  const shot = (id) => T[id];
  const end = (key, word) => at(key, word, 'e');
  const dur = (key) => L[key].dur;

  window.K = { clamp, lerp, ease, prog, $, $$, type, count, words, ambient, rand, layout, at, end, dur, shot };
})();
