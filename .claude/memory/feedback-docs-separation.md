---
name: feedback-docs-separation
description: User directive - agent material (CLAUDE.md, memory, plans, migration notes, rules, skills) lives in .claude/, human docs only in docs/
type: feedback
---

Agent working material and human project documentation are kept apart. Agent side: `CLAUDE.md`, `.claude/memory`,
`.claude/plans`, `.claude/notes/` (the Python-to-Go migration record is `.claude/notes/migration/`), `.claude/rules`,
`.claude/skills`. Human side: `docs/` (API, architecture, security, design, ADRs, `docs/modules/`, `docs/README.md` index,
Ukrainian tester onboarding in `docs/uk/onboarding/`).
**Why:** the owner asked (2026-11-07) to keep agent docs and memories apart from all the docs; `docs/` is read by people
(testers, new developers), not by agents.
**How to apply:** a plan, decision log or working note goes to `.claude/plans` or `.claude/notes`, never to `docs/`. When a
plan is implemented, its user-visible result is documented in `docs/` (module note, API, uk onboarding). Docs-only and
`.claude/**` pushes do not trigger `auto-release.yml`.
