# Enterprise Plan Audit Report

**Plan:** .paul/phases/01-capture-to-disk/01-03-PLAN.md
**Audited:** 2026-09-17
**Verdict:** Conditionally acceptable — approved with the applied upgrades

---

## 1. Executive Verdict

**Conditionally acceptable.** One finding was serious enough that I would have rejected the plan on
it alone, and it is a product risk rather than a technical one.

**The Balanced preset ships a known regression behind a friendly label.** It sets 30 fps — precisely
the configuration whose interval jitter produced the "ball snapping between positions" complaint. It
took five rounds of investigation across two plans to find that, and three wrong hypotheses
(bitrate, codec, scaler) were shipped along the way. The plan describes Balanced only as "Smaller
files". A user choosing it gets the fixed bug back, with nothing in the interface connecting cause
to effect, and would reasonably report it again. The team would then be debugging a defect it
deliberately shipped.

That is not a subtle risk. Offering a setting is fine; offering it without naming what it costs is
not.

Second, the plan's most important promise — closing three acceptance criteria carried since 01-01 —
had a mechanical hole. AC-6's memory sampling could not have measured the right process, because the
same checkpoint instructs the user to open DevTools, which adds a second renderer to the very
metrics array the sampler reads. A third consecutive attempt at that criterion would have produced
another unusable number.

With those two fixed plus the write-race, I would approve this.

**Scoping note, as in prior audits.** Single-user, local, offline tool: no compliance surface. This
audit is scoped to correctness, data safety, honest interfaces, and not regressing work already
paid for.

## 2. What Is Solid

- **AC-2 demands proof in the output, not the UI.** A setting that is stored, displayed, and never
  reaches `MediaRecorder` would satisfy a naive check while doing nothing. Requiring evidence in the
  encoded file is the correct bar, and this project has already shipped three claims that were true
  in the UI and false in reality.
- **Diagnosing why AC-5 and AC-7 were untestable, rather than re-listing them.** Both were written
  against a permission prompt and a sharing bar that `setDisplayMediaRequestHandler` guarantees never
  appear. Two plans listed them; neither could ever have passed. Finding the cause is what turns a
  recurring decoration into a closeable criterion.
- **Atomic settings write reusing the recording path's reasoning.** Consistent, and correct for the
  same reason.
- **Boundaries protecting the codec preference.** Non-obvious and important: switching back to
  H.264 would silently disable bitrate control, making the entire quality picker inert. Naming it
  explicitly prevents a plausible future "simplification".
- **Preset values derived from 01-02's measurements** rather than invented.

## 3. Enterprise Gaps Identified

| #  | Gap                                                                                        | Class of risk              |
| -- | -------------------------------------------------------------------------------------------- | -------------------------- |
| G1 | Balanced (30 fps) reintroduces the fixed judder, labelled only "Smaller files"                | **Shipped regression**     |
| G2 | `getAppMetrics()` sampling cannot identify the recording renderer; DevTools adds a second      | **Unmeasurable criterion** |
| G3 | Concurrent `settings:set` calls race on a shared temp filename                                 | Self-inflicted corruption  |
| G4 | "Invalid file replaced on next write" has no trigger if the user never changes the preset      | Permanent silent fallback  |
| G5 | `__sim.failCapture()` has no stated one-shot semantics — a latched flag breaks every start      | Test hook becomes a defect |
| G6 | AC-6 compares single samples; GC timing makes the ratio arbitrary                              | Meaningless pass/fail      |
| G7 | Picker disabled only on `recording`, leaving `starting` and `saving` open                       | State race                 |
| G8 | Applied preset not observable in the app; AC-2 verifiable only by inferring from file size      | Weak evidence              |
| G9 | No `version` field in settings.json                                                            | Future migration pain      |

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| #  | Finding                          | Plan Section Modified            | Change Applied                                                                                     |
| -- | -------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| M1 | G2 — memory sampling wrong process | AC-6, Task 1                     | Resolve the recording window's pid via `webContents.getOSProcessId()` and match on it; log non-matching samples instead of counting zero |
| M2 | G1 — Balanced hides its cost      | New **AC-2b**, Task 3, invariants | Description must name the motion tradeoff; High marked recommended; "never label a known regression with only its upside" added as an invariant |
| M3 | G3 — settings write race          | Task 1                           | Serialize writes through a queue or unique temp names                                                |

### Strongly Recommended

| #  | Finding                     | Plan Section Modified | Change Applied                                                     |
| -- | --------------------------- | --------------------- | -------------------------------------------------------------------- |
| S1 | G5 — sticky test flag        | Task 2                | `failCapture()` is one-shot, cleared after use, logs when it fires   |
| S2 | G4 — corrupt file never healed | AC-4, Task 1        | Rewrite valid defaults at detection, not at next user-initiated write |
| S3 | G8 — AC-2 not observable     | Task 3                | Footer shows the in-force preset and negotiated frame rate/ceiling   |
| S4 | G6 — single-sample comparison | AC-6                 | Compare per-minute medians                                           |
| S5 | G7 — partial disable         | AC-3                  | Disable on any non-`idle` status                                     |
| S6 | G9 — no schema version       | Task 1                | `version: 1` in the written JSON                                     |

Also added an **AUDIT-ENFORCED INVARIANTS (01-03)** block and nine verification checks.

### Deferred (Can Safely Defer)

| #  | Finding                                       | Rationale for Deferral                                                                           |
| -- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| D1 | Settings migration framework                   | One `version` field is sufficient until a second schema actually exists                            |
| D2 | Store quality metadata alongside each recording | Genuinely useful, but belongs with the library phase that will display it                          |
| D3 | Preset usage telemetry                         | PROJECT.md forbids telemetry without asking. Correctly out of scope                                |
| D4 | Access control on settings.json                | Contains one enum value, no secrets. Windows file ACLs are the right layer                         |
| D5 | Multi-window settings synchronisation          | Single-window application; no second consumer exists                                               |

## 5. Audit & Compliance Readiness

**Defensible evidence.** Strong after the upgrades, and this is the plan where it matters most: it
claims to close three criteria that two previous plans claimed and did not. AC-2 requires output
evidence, AC-6 now identifies its process and compares medians, and AC-5/AC-7 have triggers that
exist. Before the upgrades, AC-6 would have produced a third unusable number.

**Silent-failure prevention.** The dominant silent failure here would have been a **silently
degraded user experience** — a preset that restores a fixed defect while reading as a reasonable
choice. M2 addresses it directly. G3 and G4 together would also have produced a config that quietly
fell back forever while appearing to work.

**Post-incident reconstruction.** Adequate. Memory series and simulated-failure events are logged.
Still console-only — the persisted-log gap has been open since 01-01's audit and remains deferred.

**Ownership.** Single operator. Clear.

**Where this would fail a real audit:** no persisted logs; no record of which preset produced which
recording, so a quality complaint cannot be traced to a setting after the fact. D2 would close the
second point and is the more valuable of the two.

## 6. Final Release Bar

**What must be true before this plan is considered complete:**

1. Balanced states its motion cost where it is chosen; High is marked as recommended.
2. Memory samples provably come from the recording renderer, verified with DevTools open.
3. Rapid preset switching leaves a valid settings file.
4. The preset is proven to reach the encoder through the output, not the interface.
5. All three carried criteria are exercised and recorded — not carried a fourth time.
6. Production build contains no `__sim` hooks.

**Risks remaining if executed as amended:**

- Balanced still offers a worse experience; it is now an informed choice rather than a trap. That is
  the correct resolution, but some users will still pick it and dislike the result.
- No per-recording record of the preset used, so quality reports remain hard to attribute.
- Logging is console-only for a third consecutive plan.

**Would I sign my name to this?** As amended, yes. As written, no — shipping Balanced labelled only
"Smaller files" would have reintroduced the project's most expensive bug as a feature.

---

**Summary:** Applied 3 must-have + 6 strongly-recommended upgrades. Deferred 5 items.
**Plan status:** Updated and ready for APPLY.

---

_Audit performed by PAUL Enterprise Audit Workflow_
_Audit template version: 1.0_
