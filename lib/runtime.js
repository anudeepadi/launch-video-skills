// Injected before any page script. Replaces wall-clock time with a virtual clock
// so every frame is a pure function of t. The renderer calls window.__vt.seek(ms).
(() => {
  const EPOCH = 1767225600000; // fixed epoch -> Date output is deterministic
  let now = 0;

  performance.now = () => now;
  const RealDate = Date;
  class VDate extends RealDate {
    constructor(...a) { a.length ? super(...a) : super(EPOCH + now); }
    static now() { return EPOCH + now; }
  }
  window.Date = VDate;

  // Deterministic Math.random (mulberry32). Scenes can reseed via __vt.seed(n).
  let s = 0x9e3779b9;
  Math.random = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let raf = new Map(), rafId = 0;
  window.requestAnimationFrame = (cb) => { raf.set(++rafId, cb); return rafId; };
  window.cancelAnimationFrame = (id) => raf.delete(id);

  const timers = new Map(); let tid = 0;
  const run = (fn, args) => { try { typeof fn === 'function' ? fn(...args) : (0, eval)(fn); } catch (e) { console.error(e); } };
  window.setTimeout = (fn, d = 0, ...args) => { timers.set(++tid, { fn, at: now + Math.max(0, +d || 0), args }); return tid; };
  window.setInterval = (fn, d = 0, ...args) => { const e = Math.max(1, +d || 0); timers.set(++tid, { fn, at: now + e, every: e, args }); return tid; };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);

  const born = new WeakMap(); // animation -> virtual ms when first observed

  window.__vt = {
    seed(n) { s = n | 0; },
    get now() { return now; },
    seek(ms) {
      // 1. fire due timers in time order
      for (;;) {
        let id = null, tm = null;
        for (const [k, v] of timers) if (v.at <= ms && (!tm || v.at < tm.at)) { id = k; tm = v; }
        if (!tm) break;
        now = tm.at;
        if (tm.every) tm.at += tm.every; else timers.delete(id);
        run(tm.fn, tm.args);
      }
      now = ms;
      // 2. one rAF tick
      const q = raf; raf = new Map();
      for (const cb of q.values()) run(cb, [now]);
      // 3. scene hook (pure function of t in seconds)
      const S = window.SCENE;
      if (S && typeof S.onFrame === 'function') run(S.onFrame, [ms / 1000]);
      // 4. CSS animations / transitions / WAAPI: pin to virtual time
      for (const a of document.getAnimations()) {
        if (!born.has(a)) born.set(a, ms);
        a.pause();
        a.currentTime = ms - born.get(a);
      }
    },
  };
})();
