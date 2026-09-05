#!/usr/bin/env bash
# Reads a commit message from stdin, strips AI tool accreditation lines, writes to stdout.
set -euo pipefail

sed -E \
  -e '/^Co-[Aa]uthored-[Bb]y:[[:space:]]*(Cursor|Claude)/Id' \
  -e '/^Co-[Aa]uthored-[Bb]y:.*cursoragent@cursor\.com/Id' \
  -e '/^Co-[Aa]uthored-[Bb]y:.*@anthropic\.com/Id' \
  -e '/^Generated with (Cursor|Claude)/Id' \
  | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
