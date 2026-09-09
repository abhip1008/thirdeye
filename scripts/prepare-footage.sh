#!/usr/bin/env bash
#
# Turn recordings into testing footage.
#
#   scripts/prepare-footage.sh ~/Downloads/*.MOV
#
# Strips the audio, normalises to H.264, writes one file per clip into
# footage/clips/, and joins them into footage/vest-source.mp4 for the vest to
# use in place of a camera.
#
# The audio is not optional. The vest records picture only - that is the first
# thing docs/PRIVACY.md promises - and test footage carrying a soundtrack would
# be testing something the product does not do.
#
# Nothing here is committed. footage/ is gitignored, and so is every video
# extension, because this is real footage of people who did not agree to appear
# in a public repository.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/footage/clips"
JOINED="$ROOT/footage/vest-source.mp4"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/prepare-footage.sh <video> [more videos...]" >&2
  exit 1
fi

command -v ffmpeg >/dev/null || { echo "ffmpeg is not installed" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

i=1
for src in "$@"; do
  [ -f "$src" ] || { echo "not a file: $src" >&2; exit 1; }
  base=$(basename "${src%.*}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9-' '-' | sed 's/-*$//')
  out="$OUT/net-$(printf '%02d' "$i")-${base}.mp4"
  ffmpeg -hide_banner -loglevel error -y -i "$src" \
    -an -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart "$out"
  echo "  $(basename "$out")  $(du -h "$out" | cut -f1)"
  i=$((i + 1))
done

# One continuous source for the vest. Clips are padded to a common size first,
# because a source whose dimensions change mid-stream is not something a camera
# would ever do and the encoder would have to restart to follow it.
list=$(mktemp)
for f in "$OUT"/*.mp4; do printf "file '%s'\n" "$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"; done > "$list"
ffmpeg -hide_banner -loglevel error -y -f concat -safe 0 -i "$list" \
  -vf "scale=886:1920:force_original_aspect_ratio=decrease,pad=886:1920:(ow-iw)/2:(oh-ih)/2,fps=30" \
  -an -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart "$JOINED"
rm -f "$list"

echo
echo "  vest-source.mp4  $(du -h "$JOINED" | cut -f1)  $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$JOINED" | cut -d. -f1)s, loops"
echo
echo "Next:"
echo "  scripts/add-footage.sh footage/clips/*.mp4    # into the app"
echo "  THIRDEYE_SOURCE=file:../footage/vest-source.mp4  # for the vest"
