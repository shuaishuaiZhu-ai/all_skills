#!/bin/bash
# Render every *.svg in a directory to same-name *.png (2x zoom).
# Usage: render-all.sh <dir> [zoom]
set -u
DIR="${1:?usage: render-all.sh <dir> [zoom]}"
ZOOM="${2:-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
rc=0
for svg in "$DIR"/*.svg; do
  [ -e "$svg" ] || { echo "no .svg in $DIR"; exit 1; }
  node "$HERE/render.mjs" "$svg" "${svg%.svg}.png" "$ZOOM" || rc=1
done
exit $rc
