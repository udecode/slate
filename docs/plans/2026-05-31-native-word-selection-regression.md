# native word selection regression

Objective:
Slate Patch fixes native word-selection regressions in `.tmp/slate-v2`:
reproduce double-click word selection failure with real mouse input, add
behavior coverage for the native selection class, fix the shared owner, verify
focused Slate v2 gates, run autoreview from `.tmp/slate-v2`, and hand off root
cause plus proof.

Flow mode:
one-shot execution

Goal plan:
`docs/plans/2026-05-31-native-word-selection-regression.md`

Completion threshold:
- Double-clicking a word selects that word in pagination and a non-pagination
  editor surface.
- Tests assert DOM/native selection text and model selection text/range.
- Single-click caret placement and relevant text selection behavior do not
  regress for the touched owner.
- Fix lands in shared Slate React/browser selection ownership unless source
  audit proves the example is the owner.
- Focused package/browser tests, relevant typecheck, Evidence Kit decision,
  autoreview, and autogoal checker pass.

Verification surface:
- Browser reproduction and Playwright behavior tests with real mouse input.
- Source audit of Slate React selection/import/native event ownership.
- Focused package tests/typecheck for changed owners.
- Autoreview helper from `.tmp/slate-v2`.

Constraints:
- Work in `/Users/zbeyens/git/plate-2/.tmp/slate-v2`.
- Do not patch only pagination unless it is truly the owner.
- Preserve prior pagination performance and margin-click fixes.
- No commit, PR, or staging requested.

Boundaries:
- Likely owners: Slate React editable event handling, DOM selection import,
  browser harness coverage, pagination tests/examples.
- Excluded: generated output, broad release sweeps, unrelated root checkout
  files.

Blocked condition:
Block only if the only correct fix requires a public API/product decision or if
real browser selection behavior remains nondeterministic after three distinct
instrumented attempts.

Start Gates:
| Gate | Applies | Evidence |
|------|---------|----------|
| Skill analysis before edits | yes | `slate-patch` loaded from prompt; selection matrix required |
| Active goal checked or created | yes | Goal created for native word-selection regression |
| Source of truth read before edits | pending | pending |
| Reproduction before patching | pending | pending |
| Browser route identified | pending | pending |

Work Checklist:
- [x] Objective includes measurable thresholds and constraints.
- [ ] Reproduce double-click failure with real mouse input.
- [ ] Classify bug class and selection matrix slice.
- [ ] Add red behavior coverage.
- [ ] Patch shared owner.
- [ ] Run architecture pressure review.
- [ ] Verify focused package/browser gates.
- [ ] Record Evidence Kit decision.
- [ ] Run autoreview and fix accepted findings.
- [ ] Run autogoal checker.

Completion Gates:
| Gate | Applies | Required action | Evidence |
|------|---------|-----------------|----------|
| Double-click word selection | pending | Browser/test proof | pending |
| Non-pagination surface | pending | Browser/test proof | pending |
| Single-click/drag regression | pending | Focused proof or scoped reason | pending |
| Shared owner | pending | Source audit | pending |
| Typecheck/tests | pending | Run focused gates | pending |
| Evidence Kit | pending | Decide refresh/candidate/N/A | pending |
| Autoreview | pending | Run helper | pending |
| Goal plan complete | pending | Run checker | pending |

Phase / pass table:
| Phase | Status | Evidence | Next |
|-------|--------|----------|------|
| Reproduce | in_progress | pending | browser proof |
| Red coverage | pending | pending | fix |
| Implementation | pending | pending | verify |
| Verification | pending | pending | review |
| Closeout | pending | pending | final |

Selection/navigation matrix slice:
- command family: mouse double-click word selection, plus single-click caret and
  mouse drag sanity where owner overlap requires it
- direction: native word expansion at clicked point
- topology: plain blocks and paginated projected/virtualized DOM
- starting state: collapsed/no selection before click
- assertions: exact DOM selected text, model selection text/range, focus sanity

Findings:
- pending

Architecture pressure verdict:
- pending

Evidence Kit:
- pending

Review fixes:
- pending

Error attempts:
| Error / failed attempt | Count | Next different move | Resolution |
|------------------------|-------|---------------------|------------|
| none yet | 0 | pending | pending |

Verification evidence:
- pending

Reboot status:
| Where am I? | Where am I going? | What is the goal? | What learned? | What done? |
|-------------|-------------------|-------------------|---------------|------------|
| Reproduce | Browser proof and red test | Restore native double-click word selection | User reports double-click does not select word | Goal and plan created |

Open risks:
- pending
