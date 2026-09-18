# Enterprise Plan Audit Report

**Plan:** .paul/phases/02-recordings-library/02-02-PLAN.md
**Audited:** 2026-09-18
**Verdict:** Conditionally acceptable — approved with the applied upgrades

---

## 1. Executive Verdict

**Conditionally acceptable**, and the blocking finding is unusual: the plan's own remedy for its
biggest accumulated problem was set up to fail quietly.

This plan exists partly to close four defensive criteria that shipped untested across three prior
plans. Its instrument for that is `verify-guards.cjs`. But the validation it verifies lives inside
`registerRecordingProtocol()` in `src/main/index.ts`, unexported, in a module that starts the entire
application when imported. The path of least resistance for anyone writing that script — including
the author — is to reimplement the checks inside it.

A test that reimplements the thing it tests is worse than no test. It goes green while the shipped
handler drifts, and it converts an honest gap ("we have not verified this") into a false claim ("we
verified this"). Given the whole point of the task is to stop shipping unverified guards, getting
this wrong would be self-defeating in a particularly expensive way: the project would believe the
pattern was fixed.

The second must-have is a delete-by-absence bug: pruning decides what to remove by asking which
recordings still exist, and an unreadable folder makes every recording look deleted.

With those fixed, and JPEG bytes validated before they reach disk, I would approve this.

**Scoping note.** Single-user, local, offline. No compliance surface. Scoped to correctness, data
safety, and — unusually for this project — the integrity of the verification itself.

## 2. What Is Solid

- **AC-3 is the best-written criterion in this project so far.** It names the failure mode in
  advance: *"if any part of the library ever depends on the cache existing, it has become an index
  and this criterion has failed."* That is a falsifiable test of an architectural decision, not an
  aspiration, and it will still be readable when someone proposes caching durations in there too.
- **`verify-guards` asserts a legitimate file IS served.** Without that, a handler that refused
  everything would pass every refusal assertion. Few people remember to test the positive case in a
  negative-case suite.
- **Concurrency 2 rather than 4, with the reason stated** — a decode that seeks and paints costs
  more than reading metadata. The plan did not simply copy the previous number.
- **Seeking before capture.** Frame 0 of a screen recording is usually black; a grid of black tiles
  is the default failure of every naive thumbnailer.
- **`data:` rather than extending `recording:` to `img-src`.** The scheme stays scoped to media,
  which keeps the authorised CSP exception as narrow as it was granted.

## 3. Enterprise Gaps Identified

| #  | Gap                                                                                      | Class of risk              |
| -- | ------------------------------------------------------------------------------------------ | -------------------------- |
| G1 | `verify-guards.cjs` would naturally reimplement the validation it tests                     | **False verification**     |
| G2 | Pruning treats an unreadable recordings folder as "all sources deleted"                     | **Delete-by-absence bug**  |
| G3 | `thumbs:put` writes renderer-supplied bytes to disk without checking they are a JPEG         | Unvalidated write          |
| G4 | Nothing detects the "every thumbnail is frame 0 / black" failure                             | Plausible-looking uselessness |
| G5 | `__sim.emptyLibrary()` location unspecified; a main-side flag would ship in production        | Production-reachable hook  |
| G6 | Canvas size unspecified — a natural-size canvas yields ~200 KB JPEGs under a 256 KB cap       | Cap passes, cache bloats   |
| G7 | Thumbnail queueing not stated to reuse the existing per-path dedupe                          | Repeated decodes on scroll |
| G8 | Cache size unbounded                                                                         | Untidy growth              |
| G9 | Cache key uses mtime+size; a mtime-preserving edit would be missed                           | Rare staleness             |

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| #  | Finding                            | Plan Section Modified        | Change Applied                                                                                  |
| -- | ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| M1 | G1 — test would verify a copy        | AC-9, frontmatter, invariants | Extract `resolveRecordingRequest(name)` into `src/main/recordingPath.ts`; handler becomes a thin wrapper; script imports the same function. Added a criterion that no validation logic is duplicated |
| M2 | G2 — unreadable read as deleted      | AC-3                         | Pruning skips entirely and logs when the folder cannot be read; removes nothing                    |
| M3 | G3 — unvalidated bytes to disk       | Task 1                       | Verify JPEG magic (`FF D8 FF` … `FF D9`) before writing; reject and log otherwise                  |

### Strongly Recommended

| #  | Finding                       | Plan Section Modified | Change Applied                                                          |
| -- | ----------------------------- | --------------------- | ------------------------------------------------------------------------- |
| S1 | G4 — uniformly black grid      | AC-1                  | Assert two different recordings produce different thumbnail bytes         |
| S2 | G5 — hook placement            | Task 3                | `emptyLibrary()` intercepts in the renderer, never main                   |
| S3 | G6 — canvas size               | Task 2                | Set and assert canvas dimensions; byte cap is a backstop, not the control |
| S4 | G7 — duplicate queueing        | Task 2                | Reuse the existing per-path `queued` set                                  |
| S5 | G8 — unbounded cache           | Task 1                | 64 MB cap, evicting least-recently-modified entries                       |

Also added an **AUDIT-ENFORCED INVARIANTS (02-02)** block and six verification checks.

### Deferred (Can Safely Defer)

| #  | Finding                                  | Rationale for Deferral                                                                       |
| -- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| D1 | G9 — mtime-preserving edits               | Requires a tool that rewrites content while preserving both size and mtime. Not a path this app creates |
| D2 | Full LRU with access tracking             | The size cap plus mtime eviction is sufficient; tracking reads would mean writing on every view  |
| D3 | Manual "regenerate thumbnail" action      | Deleting the cache directory already achieves it, and AC-3 guarantees that is safe                |
| D4 | Hover preview / animated thumbnails       | Scope creep against "minimal surface, complete basics"                                            |
| D5 | Persisted log file                        | Standing item since 01-01, now fifth plan. Still correct to defer for a single-user local tool, but it has been deferred long enough to be a deliberate position rather than an oversight |

## 5. Audit & Compliance Readiness

**Defensible evidence.** This is the first plan in the project whose output is *itself* evidence.
`verify-guards` converts four hand-waved criteria into an automated assertion, and M1 is what makes
that assertion worth anything. After the upgrades, the claim "the protocol handler refuses
traversal" is backed by code that runs against the shipped implementation.

**Silent-failure prevention.** Two of the three must-haves are silent failures by nature: a test
passing against a copy, and a prune wiping a cache because a drive was unplugged. Neither would
produce an error message.

**Post-incident reconstruction.** Unchanged. Console-only logging, fifth consecutive plan. Recorded
in D5 as a deliberate position rather than an omission.

**Ownership.** Single operator. Clear.

**Where this would fail a real audit:** no record of what was pruned or when. Minor for derived
data, but it is the same missing-log gap that has been carried since 01-01.

## 6. Final Release Bar

**What must be true before this plan is considered complete:**

1. `verify-guards.cjs` and the protocol handler share one validator, demonstrably — the checks exist
   in exactly one file.
2. Pruning with an unreadable recordings folder removes nothing.
3. A non-JPEG payload of legal size is rejected by `thumbs:put`.
4. Two different recordings produce different thumbnails.
5. Deleting the cache directory breaks nothing but freshness.
6. Production build contains no `__sim`.

**Risks remaining if executed as amended:**

- A mtime-preserving external edit would serve a stale thumbnail. Accepted.
- Thumbnail generation is still real decode work; a folder of hundreds will take time to fill,
  though bounded concurrency keeps it from blocking.
- Logging remains console-only.

**Would I sign my name to this?** As amended, yes. As written, no — not because of the thumbnails,
which were carefully specified, but because the plan's instrument for ending three plans of
unverified guards would itself have verified nothing.

---

**Summary:** Applied 3 must-have + 5 strongly-recommended upgrades. Deferred 5 items.
**Plan status:** Updated and ready for APPLY.

---

_Audit performed by PAUL Enterprise Audit Workflow_
_Audit template version: 1.0_
