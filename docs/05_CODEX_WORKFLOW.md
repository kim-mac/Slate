# How to Work With Codex

## Important

Do not give Codex one prompt saying:

> Build this entire app.

Instead, keep the repository docs as persistent context and give Codex one milestone at a time.

## First message to Codex

Use:

```text
Read every Markdown file in the project docs before changing code.

These docs are the source of truth, especially the local-first and privacy requirements.

We are working only on Milestone 0 from 04_BUILD_PLAN.md.

First inspect the current repository and tell me:
1. what currently exists,
2. what architecture you recommend within the constraints of the docs,
3. exactly which files you will create/change.

Then implement Milestone 0 only.

After implementation:
- install dependencies,
- run lint,
- run typecheck,
- run relevant builds/checks,
- fix any errors,
- summarize what you changed.

Do not begin Milestone 1.
```

## Prompt for later milestones

Replace `X` with the current milestone:

```text
Read the project docs again and inspect the current repository state.

Implement Milestone X from 04_BUILD_PLAN.md only.

Before editing, briefly state:
- what already exists from previous milestones,
- the implementation approach,
- files you expect to modify.

Follow 03_ENGINEERING_RULES.md strictly.

Do not add future-scope features.

After implementation, run all relevant checks and fix issues before finishing.

End with:
1. completed work,
2. tests/checks run,
3. any known limitations,
4. the exact next milestone — but do not implement it.
```

## When Codex starts drifting

Use:

```text
Stop. Re-read 00_READ_ME_FIRST.md, 01_PRODUCT_SPEC.md, 02_ARCHITECTURE.md and 03_ENGINEERING_RULES.md.

Do not redesign the product or add features outside the current milestone.

Show me which part of your current implementation conflicts with those docs, then correct only that conflict.
```

## When debugging

Use:

```text
Do not patch randomly.

Reproduce the issue first.
Identify the root cause.
Explain it briefly.
Make the smallest safe fix.
Then rerun the relevant checks.

Do not refactor unrelated working code.
```

## Before every commit

Ask Codex:

```text
Review the current diff against the project docs.

Check specifically for:
- accidental network/cloud dependencies,
- overly broad browser permissions,
- security issues in the local bridge,
- unnecessary dependencies,
- unrelated code changes,
- TypeScript errors,
- dead code.

Fix issues you find, run checks, then suggest a concise commit message.
```

## Recommended human workflow

For each milestone:

1. Give Codex the milestone prompt.
2. Let it implement.
3. Run the app yourself.
4. Test the actual user flow.
5. Tell Codex exact bugs you observe.
6. Have Codex fix those before moving on.
7. Commit.
8. Begin the next milestone.

Do not stack several untested milestones together.
