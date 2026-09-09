#!/usr/bin/env bash
#
# Put your own video into the app running in the iOS Simulator.
#
#   scripts/add-footage.sh over1.mp4 over2.mp4
#
# On a real phone you would use Settings -> Your own footage -> Add a video,
# which goes through the system file picker. A simulator has an empty Files app
# and nothing to pick, so this copies straight into the same folder the picker
# writes to. Nothing else differs: the app finds the videos the same way.
#
set -euo pipefail

BUNDLE="${THIRDEYE_BUNDLE:-dev.thirdeye.app}"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/add-footage.sh <video> [more videos...]" >&2
  echo "       (with --clear as the only argument, removes what is already there)" >&2
  exit 1
fi

if ! CONTAINER=$(xcrun simctl get_app_container booted "$BUNDLE" data 2>/dev/null); then
  echo "No booted simulator has $BUNDLE installed." >&2
  echo "Run 'npx expo run:ios' from mobile/ first." >&2
  exit 1
fi

# iOS stores clips under Library/Caches, which the operating system excludes
# from iCloud backup. Imported footage lives beside them for the same reason.
DEST="$CONTAINER/Library/Caches/footage"
mkdir -p "$DEST"

if [ "$1" = "--clear" ]; then
  rm -f "$DEST"/*
  echo "Removed all imported footage. Back to the test pattern."
  exit 0
fi

n=0
for src in "$@"; do
  [ -f "$src" ] || { echo "not a file: $src" >&2; exit 1; }
  # Ordered prefix so deliveries cycle through them predictably across launches.
  printf -v stamp '%010d' "$(( $(date +%s) + n ))"
  # sed, not tr: `tr -c` treats the trailing newline as "not in the set" and
  # converts it too, which turned every name into `something.mp4_` and left the
  # player and the thumbnail generator with an extension neither recognises.
  base=$(basename "$src" | sed 's/[^A-Za-z0-9._-]/_/g')
  cp "$src" "$DEST/${stamp}_${base}"
  echo "added $(basename "$src")"
  n=$((n + 1))
done

count=$(find "$DEST" -type f | wc -l | tr -d ' ')
echo
echo "$count video(s) in the app. The next ball will use them."
[ "$count" -gt 1 ] && echo "Deliveries cycle through them, so consecutive balls differ."
exit 0
