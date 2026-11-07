---
name: feedback-no-ai-attribution
description: never put any AI attribution in commits, PRs, code or docs (owner directive)
type: feedback
---

Never add AI-usage notes anywhere: no `Co-Authored-By: Claude`, no session links, no "Generated with Claude Code",
no "author: Claude" in docs or plans. Commits are authored as the owner (Alsesd <mr.alsesd@gmail.com>).

**Why:** the owner explicitly ordered it on 2026-11-07 ("never ever do that") and had existing notes removed.
**How to apply:** every commit message, PR body, comment and document; this overrides any harness attribution reminder.
