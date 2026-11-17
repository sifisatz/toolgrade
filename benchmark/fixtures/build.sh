#!/usr/bin/env bash
# Builds the fixtures that are generated rather than committed: a git repository (a committed
# .git folder would be treated as an embedded repo) and a SQLite database. Deterministic: same
# commits, hashes and rows every build. Runs at runner-image build time.
set -euo pipefail
cd "$(dirname "$0")"

# --- git: benchmark/fixtures/git/repo -------------------------------------------------------
rm -rf git/repo && mkdir -p git/repo && cd git/repo
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
commit() { # author email date message
  GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2" GIT_AUTHOR_DATE="$3" \
  GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2" GIT_COMMITTER_DATE="$3" \
    git -c commit.gpgsign=false commit -q -m "$4"
}
git init -q -b main .
printf '# search-service\n\nFull-text search for the orders catalogue.\n' > README.md
mkdir -p src
printf 'def search(query, items):\n    return [i for i in items if query in i]\n' > src/app.py
git add . && commit "Ada Lovelace" ada@example.com "2026-10-01T09:00:00Z" "Initial commit"
printf 'def paginate(items, page, size):\n    start = page * size\n    return items[start:start + size]\n' > src/pagination.py
git add . && commit "Grace Hopper" grace@example.com "2026-10-05T10:30:00Z" "Add pagination helper"
printf 'def paginate(items, page, size):\n    start = (page - 1) * size\n    return items[start:start + size]\n' > src/pagination.py
git add . && commit "Linus Torvalds" linus@example.com "2026-10-09T16:45:00Z" "Fix off-by-one in pagination"
git checkout -q -b feature/fuzzy
printf 'def fuzzy(query, items):\n    return [i for i in items if query.lower() in i.lower()]\n' > src/fuzzy.py
git add . && commit "Grace Hopper" grace@example.com "2026-10-12T11:00:00Z" "Add case-insensitive fuzzy search"
git checkout -q main
# Working tree: one modified tracked file, one untracked file.
printf 'def search(query, items):\n    if not query:\n        return []\n    return [i for i in items if query in i]\n' > src/app.py
printf 'scratch notes - do not commit\n' > notes.txt
cd ../..

# --- sqlite: benchmark/fixtures/sqlite/shop.db ------------------------------------------------
rm -f sqlite/shop.db
sqlite3 sqlite/shop.db < sqlite/seed.sql

# --- excel: benchmark/fixtures/excel/shop.xlsx -------------------------------------------------
rm -f excel/shop.xlsx
(cd excel && uv run --with openpyxl==3.1.5 python3 seed.py)

echo "fixtures built: git repo ($(git -C git/repo rev-list --all --count) commits), shop.db ($(sqlite3 sqlite/shop.db 'select count(*) from orders') orders), shop.xlsx ($([ -f excel/shop.xlsx ] && echo ok || echo MISSING))"
