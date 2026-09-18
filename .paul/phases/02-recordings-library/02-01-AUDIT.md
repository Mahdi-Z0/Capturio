# Enterprise Plan Audit Report

**Plan:** .paul/phases/02-recordings-library/02-01-PLAN.md
**Audited:** 2026-09-17
**Verdict:** Conditionally acceptable — approved with the applied upgrades

---

## 1. Executive Verdict

**Conditionally acceptable.** This plan is a step-change in risk from everything before it, and the
original did not fully price that in.

Phase 1 wrote files. This plan **deletes user files** and **serves file bytes to renderer content**.
Those are the two operations in a desktop application where a defect stops being an inconvenience
and becomes unrecoverable data loss or an escape from the sandbox. Two of the three must-haves are
about exactly that, and neither was a subtle omission — both were places where the plan said
"validate the path" and left the hard part unspecified.

The most serious finding is not a security hole but a **helpfulness trap**: `shell.trashItem`
rejects on several real Windows configurations, and the obvious instinct when it fails is to fall
back to `unlink` so the delete "works". That would silently convert the recoverable delete the user
chose into a permanent one, discoverable only when they go looking in the Recycle Bin and find
nothing. The plan didn't say to do that — it also didn't say not to, and this is a session where a
recording was already lost to a flat battery and recovered. Getting this wrong would undo that
lesson.

With the three must-haves applied, I would approve this.

**Scoping note, consistent with prior audits.** Single-user, local, offline. No compliance surface.
Scoped to data safety, the renderer trust boundary, and not degrading what already works.

## 2. What Is Solid

- **Custom protocol instead of loosening the CSP.** The easy path was widening `media-src` to allow
  `file:`, which would let any renderer content read arbitrary local files forever, to make a video
  player work. The plan rejected that, wrote it into the boundaries, and added a `git diff` check on
  `media-src` to verification. That is the correct trade defended three ways.
- **AC-6 and AC-7 exist at all.** Deleting the item currently playing, and a file vanishing from
  Explorer mid-session, are the two things that actually happen to real libraries and are almost
  always discovered in production rather than planning.
- **Reusing the containment helper rather than writing a second.** Four handlers now take a path.
  One shared check is the only way they stay consistent as the surface grows.
- **Recycle Bin as the default**, with permanent behind a deliberate extra step.
- **Splitting thumbnails into 02-02**, and recording *why* a thumbnail cache is not the index file
  the project decided against. That distinction will be load-bearing when 02-02 is written.

## 3. Enterprise Gaps Identified

| #  | Gap                                                                                          | Class of risk              |
| -- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| G1 | `trashItem` failure unspecified — the natural fallback is permanent deletion                   | **Silent data loss**       |
| G2 | Protocol handler path derivation unspecified: encoding, separators, traversal, UNC              | **Trust boundary**         |
| G3 | Handler would serve any file in the folder, including a `.part` mid-write                       | Torn reads; wrong content  |
| G4 | Duration probes unbounded — one decode per recording, all at once                               | Scales badly, holds decoders |
| G5 | Delete could target a file an in-flight recording is writing                                    | **Corrupts a live recording** |
| G6 | Refresh trigger named only as "after a recording finishes saving", with no mechanism             | Invented duplicate signal  |
| G7 | "Newest first" undefined: birth time vs modified time, which differ for recovered recordings     | Subtly wrong ordering      |
| G8 | Empty folder and unreadable folder would present identically                                     | Misleading state           |
| G9 | A background refresh could remount the player and interrupt playback                             | Regression in use          |

## 4. Upgrades Applied to Plan

### Must-Have (Release-Blocking)

| #  | Finding                          | Plan Section Modified          | Change Applied                                                                                         |
| -- | -------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| M1 | G2 — protocol trust boundary      | AC-8, Task 1, invariants        | Single path segment only; decode exactly once then validate; reject separators, `..`, drive letters, UNC; resolve after decoding; extension allow-list; 404-equivalent on refusal |
| M2 | G1 — failed trash escalating      | New **AC-5b**, Task 1, invariants | On `trashItem` rejection: report, leave the file, **never** fall back to `unlink`                    |
| M3 | G5 — deleting a live recording    | New **AC-5c**, Task 1, invariants | Check the in-flight `active` map before deleting; the `.part` list exclusion is UI convenience, not a guarantee |

### Strongly Recommended

| #  | Finding                       | Plan Section Modified | Change Applied                                                              |
| -- | ----------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| S1 | G3 — serving the wrong files   | AC-8, Task 1          | Allow-list `.webm` / `.mp4`; never serve `.part`                              |
| S2 | G4 — unbounded probes          | Task 1                | At most 4 concurrent, visible items only, elements torn down after reading     |
| S3 | G7 — undefined sort key        | Task 1                | Modified time, with the reason recorded (recovered files have misleading birth time) |
| S4 | G9 — refresh interrupts play   | Task 3                | Key the list by path so React preserves the playing element                    |
| S5 | G6 — unnamed refresh trigger   | Task 3                | Use the existing `lastSaved` signal; do not invent a second mechanism or poll  |

Also added an **AUDIT-ENFORCED INVARIANTS (02-01)** block and seven verification checks.

### Deferred (Can Safely Defer)

| #  | Finding                                   | Rationale for Deferral                                                                            |
| -- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| D1 | G8 — distinguish unreadable from empty     | The folder is the app's own, under the user's Videos. A permissions failure here is remote and would surface in the list error path anyway |
| D2 | Virtualised list for very large libraries  | Bounded probes remove the immediate cost. Revisit when a real folder is large enough to feel slow    |
| D3 | Per-recording metadata sidecar             | Already deferred from 01-03's audit; belongs with 02-02 where thumbnails give it a second consumer   |
| D4 | Undo for permanent deletion                | Self-contradictory. The Recycle Bin **is** the undo, which is why it is the default                  |
| D5 | Search and filter                          | Explicitly out of scope, and premature before thumbnails show whether finding by name is even hard   |

## 5. Audit & Compliance Readiness

**Defensible evidence.** Adequate. The verification list now names concrete refusals to test —
traversal strings, UNC prefixes, `.part` requests — rather than asserting "paths are validated".
A reviewer can check each one.

**Silent-failure prevention.** This was the weak area and it is where the must-haves landed. Before
the upgrades there were two paths to silent harm: a failed trash quietly becoming a permanent
delete, and a delete landing on a file being written. Both now fail loudly instead.

**Post-incident reconstruction.** Unchanged and still the standing weakness: logging is console-only
for a fourth consecutive plan. It matters slightly more here, because this is the first plan whose
failures destroy files rather than producing a bad one.

**Ownership.** Single operator. Clear.

**Where this would fail a real audit:** no persisted record of deletions. If a recording goes
missing there is no way to tell whether the app trashed it, the user did, or something else removed
it. For a single-user tool that is acceptable; for anything shared it would not be.

## 6. Final Release Bar

**What must be true before this plan is considered complete:**

1. A failed `trashItem` leaves the file untouched and never escalates to permanent deletion.
2. The protocol handler refuses every listed traversal and encoding form, and serves only
   allow-listed extensions.
3. A delete aimed at an in-flight recording is refused and that recording still completes.
4. The CSP is unchanged — verified by diff, not by inspection.
5. Playback survives a background refresh.

**Risks remaining if executed as amended:**

- Deletions leave no record, so a missing recording cannot be attributed after the fact.
- Duration probing is bounded but still does real decoding work; a very large folder will feel it.
- Permanent deletion is genuinely irreversible by design. That is correct, and it is why it must
  stay visibly distinct from the default.

**Would I sign my name to this?** As amended, yes. As written, no — not because of the protocol
handler, which was merely underspecified, but because nothing in the plan prevented a failed safe
delete from turning into an unsafe one.

---

**Summary:** Applied 3 must-have + 5 strongly-recommended upgrades. Deferred 5 items.
**Plan status:** Updated and ready for APPLY.

---

_Audit performed by PAUL Enterprise Audit Workflow_
_Audit template version: 1.0_
