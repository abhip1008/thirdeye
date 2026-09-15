#!/usr/bin/env bash
#
# Install the vest service on a Raspberry Pi. Run this ON the Pi, from a clone
# of this repository:
#
#   sudo ./scripts/setup-pi.sh
#
# It does the parts that are easy to get subtly wrong: the service account, the
# /data directory the buffer and the key live in, the Python environment, and
# the systemd unit. It does NOT set up the access point - do that once the
# camera and the phone are talking, so that only one thing is new at a time.
#
# Safe to run twice. Nothing here is destructive: it creates what is missing and
# leaves what is already there, and it never touches an existing signing key,
# because a new key means re-pairing every phone.
#
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
USER_NAME=thirdeye
DATA=/data

say()  { printf '\n\033[1m%s\033[0m\n' "$1"; }
note() { printf '  %s\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "run this with sudo"; exit 1; }

say "1. packages"
apt-get update -qq
# rpicam-apps drives the ribbon camera; ffmpeg cuts the segments; qrencode turns
# the pairing payload into something a phone can scan.
apt-get install -y --no-install-recommends ffmpeg python3-venv python3-dev rpicam-apps qrencode
note "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | cut -d' ' -f3)"

say "2. service account"
if id "$USER_NAME" >/dev/null 2>&1; then
  note "$USER_NAME already exists"
else
  # No login, no home directory to fill up, and in video so it can open the
  # camera. It does not need to be able to log in to record cricket.
  useradd --system --no-create-home --shell /usr/sbin/nologin "$USER_NAME"
  note "created $USER_NAME"
fi
usermod -aG video "$USER_NAME"

say "3. storage"
# Five minutes of buffered video at 5 Mbps is about 190 MB, rewritten
# continuously. On an SD card that is a lot of writes; a USB SSD mounted at
# /data is the better home for it and this script will use one if it is there.
mkdir -p "$DATA/buffer" "$DATA/matches"
chown -R "$USER_NAME:$USER_NAME" "$DATA"
chmod 750 "$DATA"
note "$DATA on $(findmnt -no SOURCE --target $DATA)"
note "$(df -h "$DATA" | awk 'NR==2 {print $4" free"}')"

say "4. python environment"
if [ ! -d "$REPO/vest/.venv" ]; then
  python3 -m venv "$REPO/vest/.venv"
fi
"$REPO/vest/.venv/bin/pip" install -q --upgrade pip
"$REPO/vest/.venv/bin/pip" install -q -e "$REPO/vest"
note "installed into $REPO/vest/.venv"

say "5. configuration"
if [ -f /etc/thirdeye.env ]; then
  note "/etc/thirdeye.env exists, leaving it alone"
else
  cp "$REPO/vest/deploy/thirdeye.env" /etc/thirdeye.env
  note "copied /etc/thirdeye.env - EDIT IT before starting: the camera, the"
  note "capture mode, and the address the pairing code advertises"
fi

say "6. service"
# The unit ships with paths under /opt/thirdeye. A clone lives wherever it was
# cloned, so the copy installed here points at this one.
sed "s|/opt/thirdeye/vest|$REPO/vest|g; s|WorkingDirectory=/opt/thirdeye|WorkingDirectory=$REPO/vest|" \
  "$REPO/vest/deploy/systemd/thirdeye.service" > /etc/systemd/system/thirdeye.service
systemctl daemon-reload
systemctl enable thirdeye >/dev/null
note "enabled; it will start on boot"

say "done"
cat <<TEXT
  Edit /etc/thirdeye.env first - especially THIRDEYE_SOURCE and the capture
  mode, which must be one the sensor really has. scripts/check-hardware.sh
  prints the list.

  Then:

    sudo systemctl start thirdeye
    journalctl -u thirdeye -f          # watch it come up
    curl -s localhost:8000/api/health  # it should say recording: true

  The pairing code, which is the only place the signing key is ever shown:

    sudo -u $USER_NAME $REPO/vest/.venv/bin/python -m thirdeye.pairing

TEXT
