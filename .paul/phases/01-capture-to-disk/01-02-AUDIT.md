# Enterprise Plan Audit Report

**Plan:** .paul/phases/01-capture-to-disk/01-02-PLAN.md
**Audited:** 2026-09-17
**Verdict:** Conditionally acceptable — approved with the applied upgrades

---

## 1. Executive Verdict

**Conditionally acceptable.** I would not have approved the original, and for a different reason
than in 01-01.

A research plan's failure mode is not a crash — it is a **false conclusion acted upon**. This plan
was going to produce numbers, and the numbers were going to drive a decision about whether the
product's primary complaint is fixable. As written, three of its key terms were undefined:
"proven not to be the bottleneck", "sustained", and the implicit assumption that consecutive runs
on a loaded machine are comparable. Undefined terms in a measurement plan produce confident
conclusions that cannot be defended, which is worse than no measurement at all — it closes an
investigation that should have stayed open.

With the decision rules, statistical definitions, and baseline controls applied, I would approve it.

The plan's own AC-1 deserves credit: it targets a confound in the author's prior measurement rather
than defending it. That is the correct instinct, and it is why the remaining gaps were fixable
rather than fatal.

**Scoping note, repeated deliberately from 01-01.** This remains a single-user, local, offline tool.
There is no compliance surface. The audit is scoped to correctness, measurement integrity, data
safety, and not damaging the user's environment. The must-haves below are genuine blockers within
that scope.

## 2. What Is Solid

- **AC-1 attacking the author's own prior measurement.** The 12 fps figure came from a test whose
  motion source may itself have been the limiter. Making that the first acceptance criterion, ahead
  of any fix, is exactly right and is the difference between research and confirmation bias.
- **AC-3 making a negative result a valid completion.** Research plans without an explicit stopping
  condition become open-ended. Naming the escalation paths (native WGC module, bundled ffmpeg) while
  fencing them out of scope prevents a quiet slide into a much larger project.
- **Carrying 01-01's three unexercised criteria forward.** They were honestly reported as unverified
  rather than marked green, and they are now scheduled rather than forgotten.
- **Boundaries protecting the 01-01 streaming contract.** Phases 2-4 depend on it; a research plan
  poking at capture must not be free to alter it.
- **Concrete lessons encoded as requirements** — fail loudly rather than printing `[object Object]`,
  hard per-run timeouts, no orphaned processes. Each came from an actual failure in this session.

## 3. Enterprise Gaps Identified

| #  | Gap                                                                                       | Class of risk            |
| -- | ------------------------------------------------------------------------------------------ | ------------------------ |
| G1 | "Motion source proven not to be the bottleneck" had no threshold — AC-1 was unfalsifiable    | **False conclusion**     |
| G2 | "Sustained >= 24 fps" undefined: mean or minimum, over what window                           | **False conclusion**     |
| G3 | No baseline control; system load varied measurably during this session                       | **False conclusion**     |
| G4 | AC-6 "memory does not scale" had no measurement method                                       | Unfalsifiable criterion  |
| G5 | Plan creates ~750 MB of test data with no free-space check or cleanup                        | User data / disk safety  |
| G6 | Benchmark output location unspecified — could pollute the user's real recordings folder       | **User data integrity**  |
| G7 | Config 6 changes a system-wide Windows display setting autonomously                          | Environment damage       |
| G8 | Chromium feature flags are process-global; no regression check after applying one             | Latent regression        |
| G9 | New `scripts/` directory sits outside both tsconfigs and may break `npm run lint`             | Quality-gate breakage    |

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| #  | Finding                       | Plan Section Modified   | Change Applied                                                                                              |
| -- | ----------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| M1 | G1 — unfalsifiable AC-1        | AC-1                    | Decision rule: source must sustain ≥ 2× target rate; otherwise the run is **inconclusive**, not evidence      |
| M2 | G2 — undefined "sustained"     | AC-3, Task 1, verification | Per-2-second-window fps; AC-3 judged on the **minimum** window, not the mean; report min/median/mean       |
| M3 | G6 — recordings-folder pollution | Task 1, boundaries     | All artifacts to a dedicated temp directory; never `Videos\ScreenRecorder`; cleanup unless `--keep`           |
| M4 | G3 — uncontrolled system load  | AC-3, Task 2            | Every candidate bracketed by default baselines; triples disagreeing >20% are discarded and re-run             |

### Strongly Recommended

| #  | Finding                    | Plan Section Modified | Change Applied                                                                                  |
| -- | -------------------------- | --------------------- | ------------------------------------------------------------------------------------------------- |
| S1 | G4 — memory unmeasurable    | AC-6                  | `getProcessMemoryInfo()` sampled every 15s; criterion is minute-5 within 1.5× of minute-1           |
| S2 | G5 — disk safety            | AC-6                  | Refuse under 3 GB free; delete the long test recording after verification                           |
| S3 | G7 — OS setting change      | Task 2 config 6       | Never change display scaling autonomously; request user action or record "not tested"               |
| S4 | G8 — global flag regression | Task 3                | After applying a flag: confirm render, record, save, startup; do not ship a flag that degrades elsewhere |
| S5 | G9 — quality gates          | Task 1                | `scripts/` must be linted or explicitly excluded; do not leave `npm run lint` failing                |

Also added an **AUDIT-ENFORCED INVARIANTS** block covering research integrity, and nine verification
checks.

### Deferred (Can Safely Defer)

| #  | Finding                                  | Rationale for Deferral                                                                                |
| -- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| D1 | Formal statistical significance testing   | Min/median/mean across bracketed baselines is sufficient to distinguish a real 2× effect from noise      |
| D2 | Cross-machine validation                  | One machine available. The finding is scoped to this hardware and the plan should say so, not pretend otherwise |
| D3 | CI integration of the benchmark           | No CI exists. Committing a repeatable script is the useful 90%                                           |
| D4 | GPU/driver-level capture profiling        | Correct next step only if flags fail, and it belongs with the native-module decision already fenced out  |
| D5 | Automated frame-level image-quality diffing | Would strengthen quality claims, but this plan is about frame *rate*; scope creep                       |

## 5. Audit & Compliance Readiness

**Defensible evidence.** Now adequate. Before the upgrades, the plan could have produced a number
like "14 fps" with no way to tell whether it measured the capturer, the test animation, or a machine
busy with orphaned processes. The decision rule, per-window statistics, and bracketed baselines make
each result interpretable in isolation.

**Silent-failure prevention.** The relevant silent failure here is a **silently wrong conclusion**,
and it was the plan's weakest area. Three of the four must-haves address exactly that.

**Post-incident reconstruction.** Good. `01-02-FINDINGS.md` records every configuration including
failures and hangs, so a later reader can see what was ruled out and re-run it.

**Ownership.** Single operator. Clear.

**Where this would fail a real audit:** results are single-machine and single-session, and the plan
must say so when reporting. Claiming a general Electron limitation from one laptop would not
survive review; claiming it for *this* hardware and configuration will.

## 6. Final Release Bar

**What must be true before this plan is considered complete:**

1. Every reported measurement is admissible under the AC-1 decision rule, or explicitly labelled
   inconclusive.
2. AC-3 judged on minimum window fps, with min/median/mean all reported.
3. Each candidate bracketed by baselines that agree within 20%.
4. No benchmark artifact written to the user's recordings folder, and cleanup performed.
5. Any applied flag passes the regression check.
6. Findings state the single-machine scope explicitly.

**Risks remaining if executed as amended:**

- Single-machine, single-session results. Real but acknowledged; the alternative is no data.
- The sweep may be inconclusive across the board — the capturer may be frame-rate limited in a way
  no flag reaches. The plan handles this as a valid outcome, which is the correct design.
- A flag could improve capture while subtly degrading something not covered by the regression check.

**Would I sign my name to this?** As amended, yes — on the understanding that its output is a
measurement scoped to this machine, not a general claim about Electron. The original would have
produced numbers I could not have defended.

---

**Summary:** Applied 4 must-have + 5 strongly-recommended upgrades. Deferred 5 items.
**Plan status:** Updated and ready for APPLY.

---

_Audit performed by PAUL Enterprise Audit Workflow_
_Audit template version: 1.0_
