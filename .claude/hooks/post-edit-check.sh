#!/usr/bin/env bash
# PostToolUse (Write|Edit): lint/test the file that was just changed.
# On failure, prints output to stderr and exits 2 so Claude sees it.
f=$(jq -r '.tool_response.filePath // .tool_input.file_path // empty')
[ -n "$f" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
case "$f" in
  "$root"/frontend/src/*.ts|"$root"/frontend/src/*.tsx)
    [ -x "$root/frontend/node_modules/.bin/eslint" ] || exit 0
    out=$(cd "$root/frontend" && npx --no-install eslint --report-unused-disable-directives --max-warnings 0 "$f" 2>&1) \
      || { echo "eslint failed for $f:" >&2; echo "$out" >&2; exit 2; }
    ;;
  "$root"/backend/app/*.py)
    uvbin=uv
    for c in /etc/profiles/per-user/"$USER"/bin/uv "$(command -v uv)"; do
      [ -x "$c" ] && "$c" --version >/dev/null 2>&1 && { uvbin=$c; break; }
    done
    out=$(cd "$root" && "$uvbin" run --locked pytest -q -x 2>&1 | tail -n 40; exit "${PIPESTATUS[0]}") \
      || { echo "backend pytest failed after editing $f:" >&2; echo "$out" >&2; exit 2; }
    ;;
esac
exit 0
