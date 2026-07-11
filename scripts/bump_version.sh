#!/bin/bash
# Usage: ./scripts/bump_version.sh [major|minor|patch]
#
# Bumps VERSION, backend/VERSION, and frontend/package.json in sync.
# After running, commit and tag:
#
#   git add VERSION backend/VERSION frontend/package.json
#   git commit -m "chore: bump version to $(cat VERSION)"
#   git tag -a "v$(cat VERSION)" -m "v$(cat VERSION)"

set -e

BUMP_TYPE=${1:-patch}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT/VERSION"
BACKEND_VERSION_FILE="$ROOT/backend/VERSION"
PACKAGE_JSON="$ROOT/frontend/package.json"

if [ ! -f "$VERSION_FILE" ]; then
  echo "ERROR: VERSION file not found at $VERSION_FILE"
  exit 1
fi

current=$(cat "$VERSION_FILE" | tr -d '[:space:]')
IFS='.' read -r major minor patch <<< "$current"

case "$BUMP_TYPE" in
  major)
    major=$((major + 1))
    minor=0
    patch=0
    ;;
  minor)
    minor=$((minor + 1))
    patch=0
    ;;
  patch)
    patch=$((patch + 1))
    ;;
  *)
    echo "Usage: $0 [major|minor|patch]"
    echo "  major — breaking change  (1.2.3 → 2.0.0)"
    echo "  minor — new feature      (1.2.3 → 1.3.0)"
    echo "  patch — bug fix          (1.2.3 → 1.2.4)"
    exit 1
    ;;
esac

new_version="$major.$minor.$patch"

echo "$new_version" > "$VERSION_FILE"
echo "$new_version" > "$BACKEND_VERSION_FILE"

if command -v jq &>/dev/null; then
  tmp=$(mktemp)
  jq --arg v "$new_version" '.version = $v' "$PACKAGE_JSON" > "$tmp"
  mv "$tmp" "$PACKAGE_JSON"
else
  sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$new_version\"/" "$PACKAGE_JSON"
  rm -f "$PACKAGE_JSON.bak"
fi

echo "Bumped: $current → $new_version"
echo ""
echo "Next steps:"
echo "  git add VERSION backend/VERSION frontend/package.json"
echo "  git commit -m \"chore: bump version to $new_version\""
echo "  git tag -a \"v$new_version\" -m \"v$new_version\""
