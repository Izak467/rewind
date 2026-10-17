#!/bin/bash
# Publish dist/ to the gh-pages branch (GitHub Pages source). Adds a commit; never force-pushes.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f dist/index.html ] || { echo "Run npm run build first."; exit 1; }
WT="${TMPDIR:-/tmp}/rewind-gh-pages"
git fetch -q origin gh-pages
git worktree remove --force "$WT" 2>/dev/null || true
git worktree add -q -B gh-pages "$WT" origin/gh-pages
( cd "$WT" && git rm -rq --ignore-unmatch . && cp -R "$OLDPWD/dist/." . && touch .nojekyll \
  && git add -A && git commit -q -m "Deploy $(git -C "$OLDPWD" rev-parse --short HEAD)" && git push -q origin gh-pages )
git worktree remove --force "$WT"
echo "Deployed. Live in a minute or two at https://izak467.github.io/rewind/"
