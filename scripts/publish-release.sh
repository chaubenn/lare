#!/usr/bin/env bash
# Publish the current commit to the public repo as ONE release commit.
#
# Development happens in the private repo, where every commit is welcome. The public repo's
# history is releases and nothing else: this takes the exact tree you are standing on, writes
# a single "Release vX.Y.Z" commit on top of the public `main`, and pushes it. The push runs
# the Prebuild there; the tag (with --tag) then publishes the installers it produced.
#
#   scripts/publish-release.sh v1.0.1            # push the release commit, tag later
#   scripts/publish-release.sh v1.0.1 --tag      # push the commit and the tag together
#   scripts/publish-release.sh v1.0.1 --notes notes.md
#
# PUBLIC_REMOTE overrides the git remote it publishes to (default: `public`).
set -euo pipefail

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-1}"; }

version="${1:-}"
[[ "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
shift
push_tag=0
notes=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) push_tag=1 ;;
    --notes) notes="${2:?--notes needs a file}"; shift ;;
    *) usage ;;
  esac
  shift
done

remote="${PUBLIC_REMOTE:-public}"
git remote get-url "$remote" >/dev/null 2>&1 || {
  echo "error: no git remote named '$remote'. Add it: git remote add public https://github.com/chaubenn/lare.git" >&2
  exit 1
}

[ -z "$(git status --porcelain)" ] || { echo "error: working tree is not clean" >&2; exit 1; }

# The app version has to agree with the tag, or release.yml refuses to publish.
want="${version#v}"
have="$(python3 -c 'import json;print(json.load(open("apps/desktop/src-tauri/tauri.conf.json"))["version"])')"
[ "$have" = "$want" ] || { echo "error: tauri.conf.json is at $have, not $want. Bump the version first." >&2; exit 1; }

git fetch --quiet "$remote" main || true
parent=""
if git rev-parse --verify --quiet "refs/remotes/$remote/main" >/dev/null; then
  parent="$(git rev-parse "refs/remotes/$remote/main")"
  if [ "$(git rev-parse "HEAD^{tree}")" = "$(git rev-parse "$parent^{tree}")" ]; then
    echo "error: public main already has exactly this tree" >&2
    exit 1
  fi
fi
if git ls-remote --exit-code --tags "$remote" "refs/tags/$version" >/dev/null 2>&1; then
  echo "error: $version already exists on $remote" >&2
  exit 1
fi

msg="$(mktemp)"
trap 'rm -f "$msg"' EXIT
{ echo "Release $version"; if [ -n "$notes" ]; then echo; cat "$notes"; fi; } > "$msg"

commit="$(git commit-tree "HEAD^{tree}" ${parent:+-p "$parent"} -F "$msg")"
echo "release commit: $commit"

git push "$remote" "$commit:refs/heads/main"
if [ "$push_tag" = 1 ]; then
  git push "$remote" "$commit:refs/tags/$version"
  echo "pushed $version"
else
  echo "pushed. Once the Prebuild is green: git push $remote $commit:refs/tags/$version"
fi
