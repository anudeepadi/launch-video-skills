---
name: launch-video
description: Make a SaaS product launch video (MP4, 16:9 or 9:16) from a product website using HTML/CSS scenes, deterministic Playwright frame capture, ffmpeg, and local TTS. No API keys. Use when asked for a launch video, product demo video, feature announcement video, or motion-graphics promo.
---

# Launch video

Renderer: the `launch-video-skills` npm package. Full scene contract: https://github.com/anudeepadi/launch-video-skills#scene-contract

- `npx launch-video-skills setup`: one time per machine (headless Chromium + Python voice packages). Needs Node 18+, Python 3.10+, ffmpeg. Kokoro weights (~350 MB) and whisper small.en (~480 MB) download to `~/.cache/lvk` on first voice run.
- `npx launch-video-skills new <name>`: scaffolds `launch-videos/scenes/<name>/index.html` with `launch-videos/kit/` beside it.
- `npx launch-video-skills render <scene.html> [flags]`: writes to `./out/`.
- Chromium download stalls → `export LVK_CHROME=/path/to/chrome-headless-shell` (any local build).
- python.org Python on macOS fails SSL → `export SSL_CERT_FILE=$(python3 -c 'import certifi;print(certifi.where())')`.

What separates a good launch video from "AI slop" is in `references/craft.md`. Read it before storyboarding.

## Steps

1. **Brand and facts from the live product.** Fetch the site with Playwright. Record verbatim headline, subhead, feature names, the site's own example content (demo threads, prompts, code, issue lists), and CTAs. Read computed styles for font family/weight/letter-spacing and sample pixel colors for bg/text/accent (CSS vars go stale). Save logo SVG and any images to `launch-videos/scenes/<name>/assets/`. Use the site's font only if its license allows redistribution; otherwise use the closest bundled font (Inter, JetBrains Mono, Space Grotesk). Never invent metrics, customers, integrations, or UI. If something is marked planned/preview, leave it out or label it. If you can't get real UI examples, stop and say so. Put the source URL and date in a comment at the top of the scene.
2. **Script, then storyboard.** One or two short lines per shot, lifted from the site's copy; 20–40 s total. Use `say` when the spoken form differs (dots, acronyms: `say: 'Build A.I. agents'`). 5–6 shots, one idea each: hook (product or headline on screen within 2 s) → first moment of use → product in action (real UI rebuilt in HTML from the site's own example, never a screenshot) → second capability → 3 pillars or how-it-works → CTA with logo. Calm brands: `music.style: 'ambient'`, soft SFX (0.2–0.6). Dev tools: `'pulse'` and hits. Voice is optional; music-only is common on X.
3. **Write `launch-videos/scenes/<name>/index.html`** against `../../kit/kit.css` and `kit.js`. Start from the scaffolded template. Mark shots `data-shot="id"` with no hard-coded --in/--out. Voice lines go in `SCENE.voice.lines` (key, shot, text/say, at/after, `pause` beats). Pin beats to speech with `data-on="key"`, `data-on="key:word"`, `data-edge="e"`. Call `K.layout()` after defining SCENE, then derive JS beats from `K.at/K.end/K.shot`: typing speed = text length / spoken duration, cursor click on the key word, type-sound cues from the same constants. `onFrame(t)` must be pure in t. JS transforms go on wrappers with no CSS animation class. No large `filter: blur`, `backdrop-filter`, or full-screen blend modes.
4. **Review loop.** `npx launch-video-skills render launch-videos/scenes/<name>/index.html --sheet 1`. Every `<- ASR heard:` line is a possible mispronunciation: respell with `say` and re-check (whisper sometimes mishears correct audio; flag those for a human listen). Read the sheet PNG for: text over busy imagery, small-text legibility, empty frames, mid-transition collisions, typing finishing before the shot ends, broken syntax highlighting. `--stills t1,t2` for full-res checks. Iterate with taste notes ("too fast", "unclear what happened") rather than one-shot.
5. **Render and verify.** `npx launch-video-skills render launch-videos/scenes/<name>/index.html --workers 4`. Then:
   - `ffprobe`: h264 + aac, expected duration.
   - `volumedetect`: mean about −19 to −17 dB, max under −1 dB.
   - Sync: transcribe the final MP4 with faster-whisper small.en word timestamps; each line's first word within ~0.2 s of the timeline printed in the log. Key words land on visual beats.
   - Continuity: compare frames across worker boundaries (frame count / workers).
6. **Deliver.** Hand over the MP4 path. Never overwrite an earlier cut (`mv -n` or a new `--out`). Say plainly that voice and music are synthesized and haven't been checked by ear. Offer post copy that avoids "made in one prompt" claims. Paid voices (ElevenLabs, OpenAI, Google) are a swap inside the package's `lib/tts.py`; mention only if the user wants a more human read.
