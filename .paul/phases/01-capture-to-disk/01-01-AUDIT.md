# Enterprise Plan Audit Report

**Plan:** .paul/phases/01-capture-to-disk/01-01-PLAN.md
**Audited:** 2026-09-16
**Verdict:** Conditionally acceptable — approved only with the applied upgrades

---

## 1. Executive Verdict

**Conditionally acceptable.** I would not have approved the plan as originally written, and the
blocking reason was not a missing control — it was an architectural defect that every later phase
would have inherited.

The original save path buffered the entire recording in renderer memory, then moved it across IPC
as one `ArrayBuffer`. That is at least three full copies of the recording (Blob → ArrayBuffer →
structured clone → Buffer) and it scales linearly with recording duration. A twenty-minute 1080p
capture is several hundred megabytes before copies; an hour is not survivable. It also runs into
Electron's IPC message-size ceiling. Phases 2, 3 and 4 all build on this IPC contract, so shipping
it would have meant changing the foundation later rather than extending it.

With the streaming contract, atomic writes, and display correlation applied, I would approve this
plan and sign my name to it — with the scope caveat in §5.

**A calibration note, stated deliberately.** The audit brief assumes a regulated, multi-user,
auditor-reviewed system. This is a single-user, local-only, offline desktop recorder with no
accounts, no network calls, and no third-party data. Applying SOC 2 / ISO controls here would be
fabricating requirements the plan does not imply, which the workflow explicitly forbids. I have
therefore audited hard on **correctness, data integrity, failure visibility, and maintenance
hazard**, and have explicitly deferred the compliance apparatus with reasons in §4. Anyone reading
this report later should not mistake that scoping for leniency — the must-have findings below are
genuine release blockers.

## 2. What Is Solid

- **The vertical slice boundary.** One thin slice through main → preload → renderer, with audio,
  window selection, region cropping, and the library all explicitly excluded. This is the correct
  shape: it produces something verifiable end-to-end rather than three layers that each prove
  nothing on their own.
- **The `<boundaries>` section.** Protecting the CommonJS decision, the TypeScript pin, and the
  `contextIsolation`/`nodeIntegration` settings is exactly right. Each of those has already cost
  real debugging time in this project, and each would be easy to "helpfully" undo during APPLY.
- **Runtime container negotiation.** Choosing the container via `MediaRecorder.isTypeSupported()`
  rather than hardcoding is correct and avoids a class of "works on my machine" failure.
- **Writing to `app.getPath('videos')`, with the prohibition on `__dirname`/`app.getAppPath()`
  stated inline.** This is the one decision that keeps the MSIX path open, and stating the reason
  next to the instruction is what will stop it being casually changed later.
- **The human-verify checkpoint.** Correct call. No automated check in this plan can prove a video
  file actually plays; only a human opening it can.
- **AC-4 existing at all.** Planning the cancel path before the happy path is the right instinct.

## 3. Enterprise Gaps Identified

| #   | Gap                                                                                                   | Class of risk                  |
| --- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| G1  | Whole recording buffered in memory and sent as one IPC message                                        | Resource exhaustion; latent    |
| G2  | Display source selected without correlating to the primary display                                     | Correctness; AC unverifiable   |
| G3  | No error path for write failure — disk full, permission denied, AV lock                               | **Silent failure**             |
| G4  | Timestamp-to-the-second filenames can collide and silently overwrite                                   | **Silent data loss**           |
| G5  | Non-atomic write — a crash mid-save leaves a truncated file under the final name                      | Data integrity                 |
| G6  | Capture terminated outside the app (OS "Stop sharing", display unplugged) unhandled                    | State ambiguity; UI lies       |
| G7  | Path containment for `reveal` specified but not how; naive `startsWith` admits sibling dirs            | Authorization boundary         |
| G8  | `getSources` returning empty not handled — `getDisplayMedia` can hang rather than reject               | Invalid state transition       |
| G9  | Concurrent `start()` could open two recorders                                                          | State ambiguity                |
| G10 | Quit during recording discards in-progress data with no finalization                                   | **Silent data loss**           |
| G11 | No logging anywhere — a failed save leaves no trace to diagnose                                        | Post-incident reconstruction   |

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| #   | Finding                            | Plan Section Modified                       | Change Applied                                                                                                                     |
| --- | ---------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| M1  | G1 — unbounded memory + IPC ceiling | AC (new AC-6), Task 1, Task 2, Task 3        | Replaced `recordings:save` with `begin`/`append`/`finish`/`abort` streaming channels; renderer uses `start(2000)` timeslice and forwards each chunk; backpressure respected |
| M2  | G2 — wrong display on multi-monitor | Task 1                                      | Select source by `String(screen.getPrimaryDisplay().id) === source.display_id`; documented empty-string fallback and empty-array `callback(null)` |
| M3  | G3 — silent write failure           | AC (new AC-5), Task 1, Task 3                | Stream errors destroy the stream, delete the `.part`, and reject with a named cause; renderer surfaces it; failure is logged        |
| M4  | G4 — filename collision             | Task 1                                      | Open with `flag: 'wx'`, retry with `-2`, `-3` … on `EEXIST`; never overwrite                                                       |

### Strongly Recommended

| #   | Finding                        | Plan Section Modified            | Change Applied                                                                              |
| --- | ------------------------------ | -------------------------------- | --------------------------------------------------------------------------------------------- |
| S1  | G5 — non-atomic write          | Task 1, verification             | All writes go to `<name>.part`, renamed on finish; crash leaves `.part`, never a corrupt final |
| S2  | G6 — external capture end      | AC (new AC-7), Task 3, checkpoint | `track.onended` finalizes exactly as user Stop; verification step added                        |
| S3  | G7 — path containment          | Task 1                           | Separator-aware comparison against `resolve(dir) + path.sep`; sibling-prefix case called out    |
| S4  | G8 — empty source list         | Task 1                           | `callback(null)` so `getDisplayMedia` rejects cleanly into AC-4                                 |
| S5  | G9, G10 — re-entry and quit    | Task 1, Task 3                   | `start()` guards on status; `before-quit` finalizes any open stream                             |
| S6  | G11 — diagnosability           | Task 1                           | `console.error` on every rejected IPC call and stream failure                                   |

Also added: an **AUDIT-ENFORCED INVARIANTS** block in `<boundaries>` so these cannot be quietly
traded away during APPLY, plus seven verification checks and three checkpoint steps.

### Deferred (Can Safely Defer)

| #   | Finding                                  | Rationale for Deferral                                                                                                                  |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | SOC 2 / ISO audit trail, retention policy | No accounts, no network, no third-party data, single operator. There is no audit subject. Fabricating one would add cost and no safety.    |
| D2  | Encryption at rest for recordings         | BitLocker is the correct control at this layer. App-level encryption would directly break AC-2 ("plays in Windows Media Player").          |
| D3  | Telemetry / metrics                       | PROJECT.md forbids telemetry without asking. Correctly out of scope.                                                                       |
| D4  | Code signing / publisher identity         | Already covered by an existing Key Decision — the Store re-signs on submission. Packaging concern, not a Phase 1 concern.                  |
| D5  | Disk-space pre-check before recording     | Real, but streaming writes now fail loudly via AC-5 instead of silently. A pre-flight free-space check is a UX improvement for a later phase. |
| D6  | Recording duration cap                    | Was only needed to paper over G1. With streaming writes the ceiling is disk space, which is the correct limit.                              |

## 5. Audit & Compliance Readiness

**Defensible evidence.** Adequate for the system's actual scope. After the upgrades, every failure
path either produces a file or produces a logged error — there is no path that silently succeeds.
Before the upgrades there were three.

**Silent-failure prevention.** This was the weakest area and is where most of the applied work went.
G3, G4 and G10 were all silent-loss paths: a write that fails with no message, a recording that
overwrites its predecessor, and a quit that discards data. All three now fail loudly or not at all.

**Post-incident reconstruction.** Acceptable, not strong. `console.error` output is not persisted
to a log file, so a failure reported days later cannot be reconstructed. I am accepting this for a
single-user local tool where the operator is the developer; it would not pass in a multi-user
system. Flagging it as the first thing to revisit if this ever ships beyond personal use.

**Ownership and accountability.** Single operator, single maintainer. Clear by construction.

**Where this would fail a real audit:** no persisted logs, no retention policy, no access control on
the recordings directory beyond Windows file ACLs. All three are appropriate omissions at this
scope and inappropriate ones if the project ever gains multiple users or network sync.

## 6. Final Release Bar

**What must be true before this plan ships:**

1. All four must-have upgrades implemented as specified, not approximated.
2. The `.part` → rename sequence verified by actually killing the app mid-recording.
3. Multi-monitor primary-display selection verified on real hardware, or explicitly noted as
   unverified if no second monitor is available.
4. A recording of at least five minutes completes without memory growth tracking duration.
5. The human-verify checkpoint passed, including the "Stop sharing" path.

**Risks remaining if shipped as-is after the upgrades:**

- Console-only logging means a failure reported after the fact may be unreconstructable.
- No free-space pre-check; a full disk surfaces as a mid-recording error rather than a refusal
  to start.
- Container selection is runtime-negotiated, so output format may differ across machines. Fine for
  personal use; would need pinning before Store distribution.

**Would I sign my name to this system?** After the applied upgrades, yes — for its stated scope of a
single-user local recorder. I would not have signed the original plan, on G1 alone.

---

**Summary:** Applied 4 must-have + 6 strongly-recommended upgrades. Deferred 6 items.
**Plan status:** Updated and ready for APPLY.

---

_Audit performed by PAUL Enterprise Audit Workflow_
_Audit template version: 1.0_
