---
name: remove-ai-accreditation
description: Use when commit messages contain Cursor or Claude co-author trailers, Generated-with lines, or the user asks to strip AI tool attribution from git history before push or after review
---

# Remove AI Accreditation from Commits

## Overview

Cursor and Claude append accreditation to commit messages (`Co-authored-by: Cursor`, `Co-Authored-By: Claude … @anthropic.com`, etc.). Strip these from every affected commit before sharing history. Never add them in new commits.

**Announce at start:** "I'm using the remove-ai-accreditation skill to clean commit messages."

## Lines to Remove

Match case-insensitively and delete entire lines:

| Pattern | Example |
|---------|---------|
| Cursor co-author | `Co-authored-by: Cursor <cursoragent@cursor.com>` |
| Claude co-author | `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` |
| Generated-with footer | `Generated with Cursor` / `Generated with Claude Code` |
| Any co-author to anthropic.com or cursoragent@cursor.com | catch-all for model name variants |

Use the bundled filter script: `.cursor/skills/remove-ai-accreditation/strip-ai-trailers.sh`

## Step 1: Scan

Pick the range that contains the commits to clean:

```bash
# Feature branch commits not yet on main
RANGE='origin/main..HEAD'

# Current branch tip (includes main when HEAD == origin/main)
RANGE='HEAD'

# Every ref
RANGE='--all'
```

Run the scan:

```bash
git log --format='%H %s' $RANGE | while read -r hash subject; do
  if git log -1 --format='%B' "$hash" | grep -qiE \
    'co-authored-by:.*(cursor|claude|cursoragent@cursor\.com|@anthropic\.com)|generated with (cursor|claude)'; then
    echo "$hash $subject"
  fi
done
```

When `origin/main..HEAD` is empty but `HEAD` still shows matches, the accreditation is already on main — use the `HEAD` or `--all` range and treat as a shared-history rewrite (Step 2 applies).

If every scan is empty, report clean and stop.

## Step 2: Check Push State

```bash
git status -sb
git log --oneline origin/$(git rev-parse --abbrev-ref HEAD)..HEAD 2>/dev/null || true
```

| State | Action |
|-------|--------|
| Commits not pushed | Rewrite freely |
| Commits already pushed | **Warn the user.** Rewriting requires force-push. Do not force-push unless they explicitly ask. |
| Commits on shared/main | Stop and ask — never rewrite main without explicit approval |

## Step 3: Rewrite History

Set the filter script path (run from repo root):

```bash
STRIP="$(git rev-parse --show-toplevel)/.cursor/skills/remove-ai-accreditation/strip-ai-trailers.sh"
chmod +x "$STRIP"
BASE="$(git merge-base HEAD origin/main)"
```

### Branch commits only (typical Conductor workspace)

Rewrites commits on the current branch since it diverged from `origin/main`:

```bash
git filter-branch -f --msg-filter "$STRIP" -- "$BASE"..HEAD
```

When accreditation is already on `origin/main` (branch tip equals main), rewrite from the oldest affected commit through HEAD:

```bash
OLDEST=$(git log --reverse --format='%H' HEAD | while read -r h; do
  git log -1 --format='%B' "$h" | grep -qiE \
    'co-authored-by:.*(cursor|claude|cursoragent@cursor\.com|@anthropic\.com)|generated with (cursor|claude)' \
    && echo "$h" && break
done)
git filter-branch -f --msg-filter "$STRIP" -- "${OLDEST}^"..HEAD
```

### Single most recent commit (unpushed)

If only `HEAD` is affected and it has not been pushed:

```bash
git commit --amend -m "$(git log -1 --format='%B' | "$STRIP")"
```

### All history on all refs

Only when the user explicitly wants every branch cleaned:

```bash
git filter-branch -f --msg-filter "$STRIP" -- --all
```

Prefer `git filter-repo` when installed (faster, maintained):

```bash
git filter-repo --commit-callback '
import re
msg = commit.message.decode("utf-8")
msg = re.sub(r"(?im)^Co-[Aa]uthored-[Bb]y:.*(?:cursor|claude|cursoragent@cursor\.com|@anthropic\.com).*\n?", "", msg)
msg = re.sub(r"(?im)^Generated with (?:Cursor|Claude).*\n?", "", msg)
commit.message = msg.strip().encode("utf-8") + b"\n"
'
```

## Step 4: Verify

Re-run the scan from Step 1. It must return no matches.

Spot-check rewritten messages:

```bash
git log --format='%B%n---' -5
```

## Step 5: Cleanup filter-branch Backup (if used)

```bash
rm -rf .git/refs/original/
git reflog expire --expire=now --all
git gc --prune=now
```

## Prevention — New Commits

When creating commits:

- **Never** append `Co-authored-by: Cursor` or Claude co-author lines.
- If a tool auto-adds them, amend immediately before push: `git commit --amend` with a cleaned message.
- When using HEREDOC commit messages, do not include accreditation lines.

Optional local hook (`.git/hooks/prepare-commit-msg`) to strip automatically:

```bash
#!/usr/bin/env bash
STRIP="$(git rev-parse --show-toplevel)/.cursor/skills/remove-ai-accreditation/strip-ai-trailers.sh"
[ -x "$STRIP" ] || exit 0
CLEAN=$("$STRIP" < "$1")
printf '%s' "$CLEAN" > "$1"
```

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Rewriting pushed commits without warning | Always confirm before force-push |
| Using `git rebase -i` on dozens of commits | Use `filter-branch` or `filter-repo` with the strip script |
| Leaving blank trailer lines | The strip script trims trailing blank lines |
| Only fixing the latest commit when several are affected | Scan the full branch range first |
| Force-pushing to main | Never unless user explicitly requests |

## Red Flags — STOP

- Force-pushing without explicit user request
- Rewriting commits on `main`/`master` that others may have pulled
- Skipping verification scan after rewrite
- Adding AI co-author lines to "give credit" — omit them entirely
