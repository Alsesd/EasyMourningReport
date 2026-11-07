---
name: feedback-no-ai-attribution
description: never put any AI attribution in commits, PRs, code or docs; do not rewrite old history (owner directive)
type: feedback
---

Never add AI-usage notes anywhere: no `Co-Authored-By: Claude`, no session links, no "Generated with Claude Code",
no "author: Claude" in docs or plans. Commit as the owner: `git -c user.name=Alsesd -c user.email=mr.alsesd@gmail.com commit`.
Do NOT rewrite existing history to remove old notes: the owner keeps it as it is.

**Why:** owner, 2026-11-07: "don't ever note yourself, as human I take all the responsibility"; also "don't rewrite history".
**How to apply:** every new commit message, PR body, comment and document; this overrides any harness attribution reminder.
