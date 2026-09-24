# launch-video-skills

An agent skill (and the renderer behind it) that turns a product website into a motion-graphics launch video: the kind SaaS teams post on X. Works with Claude Code, Codex, Cursor, Gemini CLI, and OpenCode.

HTML/CSS scene → deterministic frame capture (Playwright/Chromium) → MP4 (ffmpeg). Local narration (Kokoro TTS) with word-level sync (faster-whisper). Music and SFX synthesized by ffmpeg on the same timeline. No video-gen model, no API keys, MIT.

## Install

```bash
npx launch-video-skills install    # copies the skill into every agent found in your home dir
npx launch-video-skills setup      # one time: headless Chromium + Python voice packages
```

Then ask your agent: "make a launch video for https://your-product.com" (in Claude Code: `/launch-video ...`).

| Agent | Skill folder (user) | `--project` folder |
|---|---|---|
| Claude Code | `~/.claude/skills` | `.claude/skills` |
| Codex | `~/.agents/skills` | `.agents/skills` |
| Cursor | `~/.cursor/skills` | `.cursor/skills` |
| Gemini CLI | `~/.gemini/skills` | `.gemini/skills` |
| OpenCode | `~/.config/opencode/skills` | `.opencode/skills` |

Pick agents with `--agents claude,codex` (or `all`). Add `--project` to install into the current repo so teammates get it too. Requires Node 18+, Python 3.10+, ffmpeg.

The skill (`skills/launch-video/SKILL.md`) runs brand extraction → script → storyboard → scene → review loop → render → sync/loudness checks. `skills/launch-video/references/craft.md` holds the structure and taste rules distilled from what does well on X.

## CLI

```bash
npx launch-video-skills new my-launch                       # -> launch-videos/scenes/my-launch/index.html + launch-videos/kit/
npx launch-video-skills render launch-videos/scenes/my-launch/index.html --sheet 1   # contact sheet -> out/my-launch-sheet.png
npx launch-video-skills render launch-videos/scenes/my-launch/index.html             # MP4 -> out/my-launch.mp4
```

## Run from a clone

```bash
npm i                      # from a clone of this repo; playwright 1.56.0
npx playwright install chromium   # first time on a new machine
# or reuse any local headless Chromium: export LVK_CHROME=/path/to/chrome-headless-shell
# python.org Python on macOS: export SSL_CERT_FILE=$(python3 -c 'import certifi;print(certifi.where())') before first voice run
node render.mjs scenes/_template/index.html --sheet 1   # contact sheet, 1 frame/sec -> out/_template-sheet.png (~10s)
node render.mjs scenes/_template/index.html --stills 2.9,14.2   # full-res PNGs of specific moments
node render.mjs scenes/_template/index.html             # full MP4 -> out/_template.mp4
```

Narration needs Python once: `pip install -r requirements.txt` (Kokoro-82M TTS, ~350 MB of weights downloaded on first run to `~/.cache/lvk`; faster-whisper small.en for word alignment, ~480 MB).

Options: `--no-voice`, `--voice af_heart|am_michael|bf_emma|...`, `--speed 1.1`, `--out file.mp4`, `--fps 30|60`, `--workers N`, `--audio track.mp3` (replaces the synthesized music bed; cues still play), `--no-sfx`, `--no-music`, `--grain 0-10`, `--png` (lossless frames), `--step 0.1` (replay granularity in review modes).

Timing on a 2-core container: 29 s @ 1080p30 ≈ 2 min. Scales with cores (`--workers`).

## How it works

- `lib/runtime.js` is injected before page scripts. It replaces `performance.now`, `Date`, `requestAnimationFrame`, `setTimeout/setInterval`, and `Math.random` with a virtual, seeded clock.
- For each frame, `__vt.seek(ms)` fires due timers, runs one rAF tick, calls `SCENE.onFrame(t)`, then pauses every CSS animation/transition/WAAPI animation and sets its `currentTime` to the virtual time. Frames are pure functions of t, so frames can be captured in parallel workers and re-rendered identically.
- `lib/audio.mjs` builds SFX (`tick type pop click whoosh swoosh rise boom hit chime glitch`) and a music bed (`style: 'pulse'` with kick, or `'ambient'`) with `aevalsrc`, mixes at cue offsets, loudness-normalizes to −16 LUFS.

## Narration and sync

Voice is local and free: Kokoro-82M (Apache-2.0) through `kokoro-onnx`, about 0.5x real time on 2 CPU cores. Every clip is transcribed back with faster-whisper, which (a) gives word timestamps and (b) flags lines where the ASR heard something different from the script (mispronunciations show as `<- ASR heard: ...` in the log). Clips are cached by (voice, speed, text), so visual edits re-render without re-synthesis.

The script drives the timeline, not the other way round:

```js
voice: { voice: 'af_heart', speed: 1.1, tail: 0.35, lines: [
  { key: 'a1', shot: 'agent', text: 'Build AI agents that work alongside you.', say: 'Build A.I. agents that work alongside you.', at: 0.4 },
  { key: 'a2', shot: 'agent', text: 'Work on complex tasks together.', after: 0.9 },
  { key: 'ap', shot: 'agent', pause: 0.9 },          // silent beat
]}
```

- `<section class="shot" data-shot="agent">`: shots are laid end to end; each lasts until its last line/pause ends plus `tail`, or `data-len`, whichever is longer.
- Inside a shot, `--d` is seconds from the shot's start. `data-on="a1"` pins an element to a line's start, `data-on="a1:agents"` to a word, `data-edge="e"` to the end, `data-off` adds an offset.
- In JS: call `K.layout()` after defining `SCENE`, then use `K.at('a1', 'agents')`, `K.end('c2')`, `K.dur(key)`, `K.shot(id)` for cursor moves, typing speed (`text.length / (K.end(k) - K.at(k))`), and computed cues.
- Cues: `{ on: 'a1:agents', sfx: 'click' }`, `{ shot: 'how', t: 0, sfx: 'whoosh' }`, or absolute `{ t }`.
- Mix: voice gets high-pass, light compression and presence EQ; the music bed or `--audio` track is side-chain ducked under it; SFX drop to 70%; the master is normalized to −16 LUFS.

Paid voices are a drop-in swap inside `lib/tts.py` (write a wav per line; durations and words come from the same alignment step).

## Scene contract

One HTML file in `scenes/<name>/index.html`, 1920×1080 (override with `SCENE.width/height`, e.g. 1080×1920 for vertical).

```html
<link rel="stylesheet" href="../../kit/kit.css">
<script src="../../kit/kit.js"></script>
<section class="shot" style="--in:3.6s; --out:7.9s">          <!-- visible window -->
  <div class="display h2 up" style="--d:3.8s">Headline</div>   <!-- --d = absolute seconds -->
</section>
<script>
window.SCENE = {
  duration: 29, fps: 30,
  music: { style: 'ambient', bpm: 92, gain: 1 },
  cues: [{ t: 3.8, sfx: 'pop', gain: 0.6 }],
  onFrame(t) { K.type(K.$('#q'), 'text', t, 4.0, 38); K.count(K.$('#n'), t, 5, 1, 0, 58); },
};
</script>
```

Rules:
- All timing is absolute seconds from video start (`--in`, `--out`, `--d`), not relative to the shot.
- `onFrame(t)` must be a pure function of `t`. No `Date.now()` math that depends on call count, no real network, no `<video>`/GIF (not seekable).
- An element with a CSS animation class ignores inline `transform` after the animation ends (fill wins). Put JS-driven transforms on a wrapper or a child.
- Avoid `filter: blur()` on large layers, `backdrop-filter`, and full-screen `mix-blend-mode`: software raster makes them 100–700 ms/frame. Pre-blur images, use radial gradients for glows, use `--grain` for film grain.
- Fonts and images must be local files in the scene folder (`assets/`) or `kit/fonts/` (Inter, Space Grotesk, JetBrains Mono bundled).

Presets in `kit.css`: `.shot`, `.up .down .fade .pop .blur .left .right .wipe .grow-x .slam`, `.words` (per-word stagger; call `K.words(el)` at load), `.term` window, `.card`, `.pill`, `.orb`, `.bg-grid`.
Helpers in `kit.js`: `K.prog`, `K.ease`, `K.lerp`, `K.clamp`, `K.type` (typewriter, keeps inline tags), `K.count`, `K.words`, `K.ambient`, `K.rand`.

## Workflow

1. Pull real copy, colors, fonts, and imagery from the product site (not invented). Record the source URL and date in a comment at the top of the scene.
2. Storyboard 5–7 shots, 25–35 s: hook → problem or first moment → product in action → how it works → positioning → CTA.
3. Write the scene. Review with `--sheet 1`, fix, spot-check with `--stills`, then render.
4. Check `ffprobe` streams and `volumedetect` (target mean ≈ −19 dB, max < −1 dB). Audio is synthesized; listen before posting.

## Scenes

- `scenes/_template`: dark "inference startup" example. "Relay" and all its numbers are fictional placeholders.

## License

Code: MIT (see `LICENSE`). Bundled fonts in `kit/fonts` (Inter, JetBrains Mono, Space Grotesk) are under the SIL Open Font License 1.1 (`kit/fonts/OFL.txt`). Kokoro-82M weights are Apache-2.0 and faster-whisper models MIT; both download at runtime.
