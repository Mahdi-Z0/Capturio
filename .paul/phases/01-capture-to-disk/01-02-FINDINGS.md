# 01-02 Findings: Capture Frame Rate

**Measured:** 2026-09-17 · `npm run bench:capture`
**Scope:** single machine, single session. **Not generalisable** beyond this hardware.

| | |
| --- | --- |
| Display | 1920×1080 physical, 1536×864 logical (125% scaling), 60 Hz |
| GPU | Intel UHD 630 + NVIDIA GTX 1650 |
| Electron / Chromium | 44.3.0 / 152.0.7977.78 |
| Target frame rate | 30 fps |
| Motion source | 60 fps (pinned at the refresh ceiling) |

---

## Headline result

**The original "~12 fps capture limit" was a measurement artifact, not a defect.**

That figure came from a benchmark whose motion source was a full-screen canvas doing a per-pixel
repaint every frame. The source itself only managed ~12 fps, so the capturer was faithfully
delivering every frame that existed. AC-1 existed specifically to catch this, and it did.

With a cheap motion source running at the 60 Hz ceiling, the default path delivers **~24.5 fps
minimum** against a 30 fps target — 82% of target, not 40%.

A better configuration was then found: **~28 fps minimum with no loss of sharpness.**

## Configuration sweep

Every candidate bracketed by `default` baselines. Baselines agreed within 1.6% across the session,
so the machine was in steady state throughout.

| Config            | Status       | min fps  | mean fps | resizeMode       | Verdict                          |
| ----------------- | ------------ | -------- | -------- | ---------------- | -------------------------------- |
| `default` ×5      | ok           | 24.0–25.0 | 24.7–25.1 | `none`          | Baseline                         |
| `wgc-screen`      | ok           | 24.5     | 24.9     | `none`           | **No effect**                    |
| `wgc-desktop`     | ok           | 25.0     | 25.1     | `none`           | **No effect**                    |
| `legacy` ×3       | ok           | 27.5–28.5 | 28.2–28.6 | `crop-and-scale` | Faster, but resampler returns    |
| `legacy-noresize` ×2 | ok        | 28.0     | 27.9–28.1 | **`none`**       | **Winner — applied**             |
| `fps-min`         | error        | —        | —        | —                | `getDisplayMedia` rejects `min`  |
| `fps-exact`       | error        | —        | —        | —                | `getDisplayMedia` rejects `exact` |
| `window-capture`  | ok           | **1.0**  | **1.1**  | `none`           | Effectively frozen — see below   |
| display scaling 100% | not tested | —      | —        | —                | Requires user action; not changed autonomously |

## What was applied

Chromium's **legacy desktop-capture path** (`getUserMedia` with `chromeMediaSource: 'desktop'`),
followed by `track.applyConstraints({ resizeMode: 'none' })`.

The legacy track arrives with `crop-and-scale` enabled, which is the resampler that softens text and
which 01-01 removed. Applying the constraint afterwards strips it, so the frame-rate gain does not
cost sharpness. Both were verified in the same runs rather than assumed.

`getDisplayMedia` remains as a fallback: the legacy constraints are non-standard and could be
removed from a future Chromium.

**Net: 24.5 → 28.0 fps minimum (+14%), sharpness unchanged.**

## Notable negative results

**Windows Graphics Capture flags do nothing here.** `AllowWgcScreenCapturer` and
`AllowWgcDesktopCapturer` produced results indistinguishable from baseline. Either they are already
the default in Electron 44, or the names no longer apply. This was the leading hypothesis going in
and it was wrong.

**`getDisplayMedia` refuses `min` and `exact` frame-rate constraints** — it throws
`min constraints are not supported` / `exact constraints are not supported`. Frame rate can only ever
be a hint on that path, which is why requesting 60 earlier produced no more frames than 30.

**Window capture is effectively frozen at ~1.1 fps.** Not investigated further, because window
selection is Phase 3 scope. Logged as a deferred issue — Phase 3 cannot use this path as-is.

## Correction made during execution

The audit's AC-1 rule required the motion source to sustain **≥ 2× the target rate**. That is
unreachable: `requestAnimationFrame` is capped by the display refresh, so at a 30 fps target on a
60 Hz panel the source tops out at ~59.9 and every run was ruled inconclusive by a rounding margin.

The rule now requires `min(2 × target, 95% of refresh rate)`. A source pinned to the refresh ceiling
is running as fast as the hardware allows, which is the condition the rule was reaching for.

## Remaining limits

- **~28 fps is still below the 30 fps target.** No tested configuration reached 30. Whether the
  remaining 7% is perceptible is a question for the checkpoint, not for more measurement.
- Results are single-machine. A different GPU, refresh rate, or scaling factor may behave differently.
- Escalation paths, deliberately **not** taken in this plan: a native module using
  `Windows.Graphics.Capture` directly, or bundling ffmpeg with `ddagrab`. Both are large and
  should be a deliberate decision, not a research-plan side effect.

---

_Reproduce: `npm run bench:capture -- --config <name> --seconds 8 --json out.json`_
_Configs: default, wgc-screen, wgc-desktop, wgc-window, legacy, legacy-noresize, fps-min, fps-exact, window-capture_
