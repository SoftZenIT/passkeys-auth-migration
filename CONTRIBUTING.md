# Contributing

Issues and pull requests welcome at the GitHub repository.

## The rule: evals first

This skill is developed test-first. Every behaviour change starts as a failing
assertion, not as prose. The reason is practical — a skill that "reads better"
but scores the same has not improved, and without a baseline you cannot tell
which of the two you did.

1. **RED** — add or update assertions in `evals/evals.json` covering the new
   behaviour, and confirm the current skill *fails* them.
2. **GREEN** — write the content until they pass.
3. **Benchmark** — re-run the full suite and confirm no regression on the
   existing assertions.

Version-tag new assertions (`"v1.2.0: …"`) so a future contributor can tell
which release each one was introduced to discriminate.

## Structural validator

```bash
npm run test:evals      # node evals/run-evals.mjs
```

This is a fast, deterministic check — it validates the shape of
`evals/evals.json` (unique ids, non-empty prompts, explicit `should_trigger`,
both positive and negative coverage) and greps the skill corpus for required
literal patterns. It does **not** grade model output. Keep it green in every
commit; it catches a whole class of mistakes for free.

When you add a feature whose absence should be caught structurally, add its
canonical literal to the pattern list (e.g. `conditionalCreate`,
`uiMode: 'immediate'`). Pick a string that only appears when the feature is
genuinely documented — a pattern that already matches for unrelated reasons
cannot discriminate and gives false confidence.

## Full benchmark

The real grading runs through the **skill-creator toolchain**: each eval prompt
is executed by a subagent with the skill loaded, and each assertion in
`evals/evals.json` is graded against that output, with an old-version baseline
run alongside for comparison.

```bash
# from the skill-creator plugin directory
python -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name passkeys-auth-migration
python eval-viewer/generate_review.py <workspace>/iteration-N \
  --skill-name passkeys-auth-migration \
  --benchmark <workspace>/iteration-N/benchmark.json
```

Results live in `passkeys-auth-migration-workspace/iteration-N/`, one directory
per eval, each holding `with_skill/` and `old_skill/` runs plus `grading.json`.

Two things worth knowing before you interpret a benchmark:

- **Subagent grading is stochastic.** A single run's per-assertion delta is not
  evidence. Compare versions in the *same* batch, and re-run anything ambiguous
  several times before concluding a change caused it.
- **Some assertions fail on both versions.** Those are grader strictness or
  harness artifacts, not regressions. Check the baseline before "fixing" them.

## Changing the trigger description

The `description` in `SKILL.md` frontmatter decides whether the skill activates
at all, so it is the highest-leverage and highest-risk field in the repo.

- Keep the whole frontmatter under **1024 characters**.
- Describe **when to use** the skill, never summarise its workflow — a
  description that explains the process invites agents to follow the summary
  instead of reading the skill.
- Leave the do-not-trigger clause intact; it is what keeps the negative evals
  (7 and 8) passing.
- Re-run the trigger evals after any edit, positives *and* negatives.

## Adding stack support

1. Verify the library choice against `references/library-matrix.md` and pin a
   minimum version with its breaking-change note.
2. Add the ORM/schema pattern to `references/db-schema.md`.
3. Add the framework example to `references/backend-integration.md` or
   `references/frontend-integration.md`.
4. Update the supported-stacks tables in `README.md`.

Cross-layer consistency matters more than any single example being elegant:
field names, encodings, and endpoint shapes must agree between the backend
example, the DB schema, and the frontend that calls it. Most real breakage in
this skill has come from two layers disagreeing — a credential ID encoded one
way on write and another on read, or an options payload shaped for one client
library and consumed by another.

## Content conventions

- Heavy teaching goes in `references/`, loaded per phase. `SKILL.md` carries
  routing, gotchas, and checklists only — it is loaded on *every* activation,
  so treat lines there as expensive.
- Date-stamp volatile claims ("as of mid-2026") and cite the browser/library
  version, so they age visibly instead of silently going wrong.
- Verify version and API claims against primary sources (MDN
  browser-compat-data, the library's own changelog) rather than memory.
