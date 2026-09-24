#!/usr/bin/env node
// Deterministic HTML -> MP4 renderer. Playwright drives Chromium on a virtual clock,
// screenshots every frame, ffmpeg encodes. No video-gen models, no animation libraries.
//
//   node render.mjs scenes/foo/index.html                 full render -> out/foo.mp4
//   node render.mjs scenes/foo/index.html --sheet 1       contact sheet, 1 frame/sec (fast review)
//   node render.mjs scenes/foo/index.html --stills 0,3.5  PNG stills at given seconds
//   options: --out path  --fps 30|60  --workers N  --audio track.mp3  --no-sfx  --no-music  --no-voice  --voice af_heart  --speed 1.1
//            --grain 0-10  --png  --step 0.1 (review modes)
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
import { buildSoundtrack } from './lib/audio.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const scenePath = argv.find((a) => !a.startsWith('--') && a.endsWith('.html'));
if (!scenePath) { console.error('usage: node render.mjs <scene.html> [--sheet 1|--stills 0,2|--out x.mp4|--fps 60|--workers N|--audio f|--no-sfx|--no-music|--png]'); process.exit(1); }

const abs = resolve(scenePath);
const url = pathToFileURL(abs).href;
const name = basename(dirname(abs)) === 'scenes' ? basename(abs, '.html') : basename(dirname(abs));
const runtime = readFileSync(join(HERE, 'lib/runtime.js'), 'utf8');
const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

let VOICE = null; // {key: {file, dur, words}} after TTS
const browser = await chromium.launch({
  executablePath: process.env.LVK_CHROME || undefined, // use a local Chromium when the pinned build isn't downloaded
  args: ['--force-color-profile=srgb', '--hide-scrollbars', '--font-render-hinting=none', '--disable-lcd-text', '--allow-file-access-from-files'],
});

async function openPage(meta) {
  const ctx = await browser.newContext({ viewport: { width: meta?.width ?? 1920, height: meta?.height ?? 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`  [page ${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => console.log(`  [page error] ${e.message}`));
  await page.addInitScript(runtime);
  if (VOICE) await page.addInitScript((v) => { window.__VOICE = v; }, VOICE);
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  });
  return page;
}

// --- read scene metadata ---
const readMeta = async () => {
  const probe = await openPage();
  const m = await probe.evaluate(() => {
    const S = window.SCENE || {};
    return { duration: S.duration, fps: S.fps, width: S.width, height: S.height, cues: S.cues || [], music: S.music || null, grain: S.grain ?? 0,
      voice: S.voice ? { voice: S.voice.voice, speed: S.voice.speed, lang: S.voice.lang, gain: S.voice.gain,
        lines: (S.voice.lines || []).filter((l) => l.pause == null).map((l) => ({ key: l.key, say: l.say || l.text })) } : null,
      narration: S.narration || [], timeline: S.timeline || null };
  });
  await probe.context().close();
  return m;
};
let meta = await readMeta();

// --- narration: TTS each line (cached), then re-probe so the layout uses real durations ---
if (meta.voice && meta.voice.lines.length && !flag('no-voice')) {
  const req = { voice: opt('voice', meta.voice.voice || 'af_heart'), speed: Number(opt('speed', meta.voice.speed || 1.0)), lang: meta.voice.lang || 'en-us', lines: meta.voice.lines, out: join(os.tmpdir(), 'lvk-voice') };
  const r = spawnSync(process.env.PYTHON || 'python3', [join(HERE, 'lib/tts.py')], { input: JSON.stringify(req), encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status) { console.error(r.stderr); process.exit(1); }
  VOICE = JSON.parse(r.stdout);
  for (const l of meta.voice.lines) {
    const v = VOICE[l.key], said = l.say.toLowerCase().replace(/[^a-z0-9]/g, '');
    const heard = (v.heard || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    log(`  voice ${l.key.padEnd(6)} ${v.dur.toFixed(2)}s  "${l.say}"${v.heard != null && heard !== said ? `   <- ASR heard: "${v.heard}"` : ''}`);
  }
  meta = await readMeta();
  log(`timeline: ${Object.entries(meta.timeline.shots).map(([k, s]) => `${k} ${s.start.toFixed(1)}-${s.end.toFixed(1)}`).join(' | ')}`);
}
if (!meta.duration) { console.error('scene must define window.SCENE = { duration: <seconds>, ... }'); process.exit(1); }
const W = meta.width ?? 1920, H = meta.height ?? 1080;
const fps = Number(opt('fps', meta.fps ?? 30));

// --- which timestamps to capture ---
let times, mode;
if (flag('sheet')) { mode = 'sheet'; const step = Number(opt('sheet', 1)); times = []; for (let t = 0; t < meta.duration; t += step) times.push(+t.toFixed(3)); times.push(+(meta.duration - 1 / fps).toFixed(3)); }
else if (flag('stills')) { mode = 'stills'; times = opt('stills', '0').split(',').map(Number); }
else { mode = 'video'; const n = Math.round(meta.duration * fps); times = Array.from({ length: n }, (_, i) => i / fps); }

const tmp = join(os.tmpdir(), `lvk-${name}-${process.pid}`);
mkdirSync(tmp, { recursive: true });
const ext = mode === 'stills' || flag('png') ? 'png' : 'jpg';
const workers = mode === 'video' ? Math.max(1, Math.min(Number(opt('workers', Math.max(1, Math.min(6, os.cpus().length)))), times.length)) : 1;
log(`${name}: ${mode}, ${times.length} frames @ ${fps}fps, ${W}x${H}, ${workers} worker(s)`);

// Soundtrack first: cheap, and a bad cue/expression should fail before minutes of capture.
let audio = null;
if (mode === 'video') {
  const track = opt('audio', null);
  if (track && !existsSync(track)) { console.error(`--audio file not found: ${track}`); process.exit(1); }
  audio = buildSoundtrack({
    dir: join(tmp, 'audio'), duration: meta.duration, cues: meta.cues,
    music: flag('no-music') ? null : meta.music, track: track ? resolve(track) : null, sfx: !flag('no-sfx'),
    voice: VOICE ? meta.narration.map((n) => ({ t: n.t, file: VOICE[n.key].file, gain: (n.gain ?? 1) * (meta.voice.gain ?? 1) })) : [],
  });
  log(audio ? 'soundtrack built' : 'no audio (no cues/music)');
}

// Each worker replays the timeline from 0 (cheap: seek without screenshot) so stateful
// rAF/timer code stays correct, then captures only its own slice.
const STEP_MS = mode === 'video' ? 1000 / fps : Number(opt('step', 0.1)) * 1000; // review modes step coarser
async function worker(w) {
  const page = await openPage({ width: W, height: H });
  const cdp = await page.context().newCDPSession(page);
  const per = Math.ceil(times.length / workers);
  const lo = w * per, hi = Math.min(times.length, lo + per);
  let cursor = 0;
  for (let i = lo; i < hi; i++) {
    const target = times[i] * 1000;
    // advance in frame-sized steps up to target so timers/rAF fire in order
    while (cursor + STEP_MS < target - 1e-6) { cursor += STEP_MS; await page.evaluate((ms) => window.__vt.seek(ms), cursor); }
    cursor = target;
    await page.evaluate((ms) => window.__vt.seek(ms), target);
    const shot = await cdp.send('Page.captureScreenshot', ext === 'jpg' ? { format: 'jpeg', quality: 94, optimizeForSpeed: true } : { format: 'png' });
    writeFileSync(join(tmp, `f_${String(i).padStart(5, '0')}.${ext}`), Buffer.from(shot.data, 'base64'));
    if (w === 0 && (i - lo) % Math.max(1, Math.floor(per / 10)) === 0) log(`  frame ${i - lo}/${hi - lo} (worker 0)`);
  }
  await page.context().close();
}
await Promise.all(Array.from({ length: workers }, (_, w) => worker(w)));
await browser.close();

const outDir = resolve(process.cwd(), 'out');
mkdirSync(outDir, { recursive: true });
const run = (args) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status) throw new Error('ffmpeg failed'); };

// Some ffmpeg builds (e.g. Homebrew's default) ship without drawtext; sheets then go unlabeled (row-major, one tile per step).
const HAS_DRAWTEXT = / drawtext /.test(spawnSync('ffmpeg', ['-hide_banner', '-filters']).stdout?.toString() ?? '');

if (mode === 'stills') {
  const d = join(outDir, `${name}-stills`); mkdirSync(d, { recursive: true });
  times.forEach((t, i) => run(['-i', join(tmp, `f_${String(i).padStart(5, '0')}.png`), join(d, `t${t.toFixed(2)}.png`)]));
  log(`stills -> ${d}`);
} else if (mode === 'sheet') {
  const cols = 4, rows = Math.ceil(times.length / cols);
  const out = opt('out', join(outDir, `${name}-sheet.png`));
  run(['-framerate', '1', '-i', join(tmp, `f_%05d.${ext}`), '-vf',
       `scale=640:-1,${HAS_DRAWTEXT ? `drawtext=text='%{eif\\:n*${opt('sheet', 1)}\\:d}s':x=12:y=10:fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6,` : ''}tile=${cols}x${rows}:padding=6:color=0x222222`,
       '-frames:v', '1', out]);
  log(`contact sheet (${times.length} frames) -> ${out}`);
} else {
  const out = resolve(opt('out', join(outDir, `${name}.mp4`)));
  run(['-framerate', String(fps), '-i', join(tmp, `f_%05d.${ext}`), ...(audio ? ['-i', audio] : []),
       ...(Number(opt('grain', meta.grain)) > 0 ? ['-vf', `noise=alls=${Number(opt('grain', meta.grain))}:allf=t`] : []),
       '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
       ...(audio ? ['-c:a', 'aac', '-b:a', '192k', '-shortest'] : []), '-movflags', '+faststart', out]);
  log(`video -> ${out}${audio ? ' (with audio)' : ' (silent)'}`);
}
rmSync(tmp, { recursive: true, force: true });
