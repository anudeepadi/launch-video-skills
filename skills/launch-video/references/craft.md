# Launch video craft

Distilled from ~15 high-engagement X threads and open-source launch-video repos (September 2026).

## Structure that works
- **Hook in 2 s.** Real product UI or the site's headline, on screen immediately. No logo sting, no voiceover intro.
- **One capability per shot.** 5–6 beats. Live typing of a prompt or input is a strong opener for AI products.
- **Show state change as a process.** Typing, a click, a card appearing, a label popping in on the spoken word. Not a static screenshot with a caption.
- **Breadth beat.** Faster cuts or a 3-column "pillars" shot after the deep feature shots.
- **Outro.** Zoom out or cut to logo, tagline, one CTA, URL. Hold 1.5–2 s.
- **Length.** 18–68 s observed on X; 20–40 s is the sweet spot for a feature launch.
- **Aspect.** 16:9 1920×1080 for X/web; 9:16 1080×1920 for Reels/Shorts (`SCENE.width/height`).

## Pacing
- Hold each text beat at least 0.6 s + 0.3 s per word. Nothing fully still for more than ~1.5 s: add a slow push-in or drift.
- Never re-explain what the viewer already understood.
- Clicks and pops land on spoken key words or downbeats.

## Professional vs "AI slop"
| Reads professional | Reads as slop |
|---|---|
| Brand tokens sampled from the live site | "Almost like your brand" colors |
| The site's own example content, rebuilt as UI | Invented or stale UI, lorem-style copy |
| One idea per shot, consistent tokens across shots | Animated slide deck: text cards with generic motion |
| Effects CSS does well: opacity, transform, gradient, mask, clip-path | Blender-looking 3D, heavy glows, stock footage energy |
| Iterated with taste notes on frames | "Made in 1 prompt" framing (now openly mocked) |

## Sound
- Music-led; voiceover optional. SFX audible but under the music (0.2–0.9 gain here).
- Normalize loudness (the renderer targets −16 LUFS).

## Process
1. Brand extraction first, saved to disk (fonts, colors, copy, logo). Fail loudly when real UI isn't available.
2. Optional: write a teardown of 1–2 reference launch films as an ingredients list. Take the ingredients, don't imitate the artifact. Keep only what CSS can do.
3. One scene file per video, one `data-shot` per idea, so a single shot can be redone without touching the others.
4. Review contact sheets, fix, re-render. Budget several passes.

## Prompts people shared (paraphrased)
- **One-shot (@moritzkremb):** pick a well-known SaaS, pull real assets from the internet, and make a professionally edited motion-graphics launch video showing features and benefits. Works as a starting brief. Replies note it needs a trained eye to avoid a stock look.
- **Design system first (@jasondoesstuff):** 1) have the agent write `design-system.md` from your app, 2) install the renderer, 3) animate your app's real interactions using that design system.
- **Director workflow (@nifinet):** teardowns of reference films → palette lifted from computed styles → CSS-only effects → tokens / kit / surfaces / scenes → direct with taste, never prescribe the fix.
