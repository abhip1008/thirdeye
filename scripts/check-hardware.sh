#!/usr/bin/env bash
#
# Run this ON the board, before trusting any of it.
#
#   scripts/check-hardware.sh
#
# Answers the questions the whole timing budget rests on, in the order they can
# kill the design. It measures rather than asks, because the specifications say
# one thing and the board in front of you is the one that has to do the work.
#
set -uo pipefail

ok()   { printf '  \033[32m%s\033[0m %s\n' "yes" "$1"; }
no()   { printf '  \033[31m%s\033[0m %s\n' " no" "$1"; }
warn() { printf '  \033[33m%s\033[0m %s\n' "  ?" "$1"; }

echo
echo "board"
model=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || uname -m)
echo "  $model"

echo
echo "1. is there a hardware video encoder?"
# This is the one that decides everything. The design assumed a board with an
# encoder on the chip. A Raspberry Pi 5 has none - the encoder was removed - so
# every frame is compressed on the CPU, for three hours, while the same CPU also
# serves files over Wi-Fi.
if command -v ffmpeg >/dev/null 2>&1; then
  encoders=$(ffmpeg -hide_banner -encoders 2>/dev/null | grep -iE "v4l2m2m|_rkmpp|_vaapi|_nvenc" | awk '{print $2}' | tr '\n' ' ')
  if [ -n "$encoders" ]; then ok "ffmpeg offers: $encoders"; else no "ffmpeg has only software encoders"; fi
else
  warn "ffmpeg is not installed"
fi
[ -e /dev/video11 ] && ok "/dev/video11 present (Pi hardware H.264 encoder)" || no "no /dev/video11 (no Pi hardware encoder)"

echo
echo "2. can the CPU keep up if it has to encode in software?"
if command -v ffmpeg >/dev/null 2>&1; then
  echo -n "     encoding 10s of 1080p30 in software... "
  # ffmpeg's own "speed=" is the number that matters: 1.0x means it compressed
  # one second of video in one second, which is exactly what recording
  # continuously demands. Anything under 1.0x falls behind and never catches up.
  speed=$(ffmpeg -hide_banner -f lavfi -i testsrc=size=1920x1080:rate=30:duration=10 \
          -c:v libx264 -preset veryfast -b:v 5M -f null - 2>&1 \
          | tr '\r' '\n' | grep -oE "speed= *[0-9.]+x" | tail -1 | grep -oE "[0-9.]+")
  echo "${speed:-?}x realtime"
  if [ -n "${speed:-}" ]; then
    awk -v s="$speed" 'BEGIN {
      if (s >= 1.8) print "  \033[32m yes\033[0m comfortable headroom for heat and Wi-Fi load";
      else if (s >= 1.2) print "  \033[33m   ?\033[0m only just keeping up - expect trouble once it is warm";
      else if (s >= 1.0) print "  \033[31m  no\033[0m no margin at all; it will fall behind under load";
      else print "  \033[31m  no\033[0m slower than realtime - it cannot record continuously at this size";
    }'
  fi
fi

echo
echo "3. which camera is attached?"
if command -v rpicam-hello >/dev/null 2>&1 || command -v libcamera-hello >/dev/null 2>&1; then
  cam=$( (rpicam-hello --list-cameras 2>/dev/null || libcamera-hello --list-cameras 2>/dev/null) | grep -E "^[0-9]+ *:" | head -3)
  [ -n "$cam" ] && { ok "ribbon camera found - use THIRDEYE_SOURCE=libcamera:0"; echo "$cam" | sed 's/^/       /'; } \
                || no "libcamera sees no camera"
else
  warn "rpicam-hello not installed; cannot check the ribbon connector"
fi
for dev in /dev/video0 /dev/video1; do
  [ -e "$dev" ] && v4l2-ctl -d "$dev" --info 2>/dev/null | grep -qi "uvc\|usb" \
    && ok "USB camera at $dev - use THIRDEYE_SOURCE=camera:$dev"
done

echo
echo "4. can the radio host its own 5 GHz network?"
# 2.4 GHz at a club ground on a Saturday is two hundred phones deep, and the
# clip transfer has to fit in the gap between deliveries.
if command -v iw >/dev/null 2>&1; then
  iw list 2>/dev/null | grep -A12 "Supported interface modes" | grep -q "\* AP" \
    && ok "the radio supports AP mode" || no "the radio does not advertise AP mode"
  iw list 2>/dev/null | grep -q "5180 MHz" \
    && ok "5 GHz channels available" || no "no 5 GHz - you are on crowded 2.4 GHz"
else
  warn "iw is not installed"
fi

echo
echo "5. is there somewhere to put five minutes of video?"
df -h /data 2>/dev/null | tail -1 | awk '{print "  " $4 " free on " $6}' || warn "/data does not exist yet"

echo
echo "Everything above is a measurement, not a specification. If 1 and 2 both"
echo "come back poor, the honest answer is a different board rather than a"
echo "cleverer pipeline."
echo
