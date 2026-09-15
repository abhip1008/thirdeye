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
# Neither ffmpeg's encoder list nor the presence of a device node is evidence.
# ffmpeg lists what it was built with - a Pi build advertises nvenc, which needs
# an NVIDIA GPU. /dev/dri exists on a Pi because of the 3D GPU, which does not
# encode video. Both of those reported a hardware encoder on a board that has
# none, one after the other.
#
# So try it. An encoder that cannot compress one second of test pattern is not
# an encoder you are going to record three hours of cricket with.
works=""
if command -v ffmpeg >/dev/null 2>&1; then
  for enc in h264_v4l2m2m h264_rkmpp h264_vaapi; do
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -q " $enc " || continue
    if [ "$enc" = "h264_vaapi" ]; then
      [ -e /dev/dri/renderD128 ] || continue
      ffmpeg -hide_banner -loglevel error -vaapi_device /dev/dri/renderD128 \
        -f lavfi -i testsrc=size=640x480:rate=30:duration=1 \
        -vf 'format=nv12,hwupload' -c:v "$enc" -f null - >/dev/null 2>&1 || continue
    else
      ffmpeg -hide_banner -loglevel error \
        -f lavfi -i testsrc=size=640x480:rate=30:duration=1 \
        -c:v "$enc" -f null - >/dev/null 2>&1 || continue
    fi
    works="$works $enc"
  done
else
  warn "ffmpeg is not installed"
fi

if [ -n "$works" ]; then
  ok "hardware encoding works:$works"
  echo "       set THIRDEYE_ENCODER to one of those"
else
  no "no working hardware encoder - every frame is compressed by the CPU"
fi

echo "     (On the ribbon-camera path ffmpeg does not encode at all - rpicam-vid"
echo "      compresses and ffmpeg only copies - so treat this as headroom, and"
echo "      watch CPU once it is actually running.)"

echo
echo "3. which camera is attached?"
if command -v rpicam-hello >/dev/null 2>&1 || command -v libcamera-hello >/dev/null 2>&1; then
  listing=$(rpicam-hello --list-cameras 2>/dev/null || libcamera-hello --list-cameras 2>/dev/null)
  cam=$(echo "$listing" | grep -E "^[0-9]+ *:" | head -3)
  if [ -n "$cam" ]; then
    ok "ribbon camera found - use THIRDEYE_SOURCE=libcamera:0"
    # The modes matter as much as the camera. A sensor asked for a geometry it
    # does not have either refuses to start or quietly gives something else,
    # and the second is the one that wastes an afternoon. Set THIRDEYE_WIDTH,
    # THIRDEYE_HEIGHT and THIRDEYE_FRAMERATE to a line from this list.
    echo "$listing" | sed 's/^/       /'
  else
    no "libcamera sees no camera"
  fi
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
echo "6. does it know what time it is?"
# A vest has no real-time clock and, at a ground, no internet. It boots
# believing it is whenever it was last switched off. The phone corrects for that
# when it signs requests, so this is not fatal - but the vest names its match
# folders after the date, and a vest that thinks it is last Tuesday files
# Saturday's cricket under last Tuesday.
if command -v timedatectl >/dev/null 2>&1; then
  synced=$(timedatectl show -p NTPSynchronized --value 2>/dev/null)
  [ "$synced" = "yes" ] && ok "clock is synchronised: $(date)" \
                        || warn "clock is NOT synchronised: $(date) - fit an RTC battery, or set it before a match"
else
  warn "cannot tell; the clock currently reads $(date)"
fi

echo
echo "Everything above is a measurement, not a specification. If 1 and 2 both"
echo "come back poor, the honest answer is a different board rather than a"
echo "cleverer pipeline."
echo
