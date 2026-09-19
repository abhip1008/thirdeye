#!/usr/bin/env bash
#
# Turn the vest into its own Wi-Fi network. Run this ON the Pi:
#
#   sudo ./scripts/setup-hotspot.sh 'a-passphrase-you-choose'
#
# Do this LAST, after a clip has already reached a phone over ordinary Wi-Fi.
# A camera and a network are two new things and they should not be new on the
# same afternoon.
#
# This uses NetworkManager, which is what Raspberry Pi OS runs. The
# hostapd/dnsmasq files in vest/deploy are for the production image, which does
# not; running both on this board is a fight, not a configuration.
#
# READ THIS FIRST: the Pi has one radio. The moment the hotspot comes up it
# stops being on your home Wi-Fi, so an SSH session over Wi-Fi dies with it.
# Use Ethernet, or a keyboard and monitor, or reconnect afterwards by joining
# the hotspot and using the address below.
#
set -euo pipefail

NAME=thirdeye-ap
SSID=${THIRDEYE_SSID:-thirdeye-vest-01}
ADDRESS=${THIRDEYE_AP_ADDRESS:-192.168.43.1}
IFACE=${THIRDEYE_AP_IFACE:-wlan0}
BAND=${THIRDEYE_AP_BAND:-a}       # a = 5 GHz, bg = 2.4 GHz
CHANNEL=${THIRDEYE_AP_CHANNEL:-36}

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "run this with sudo"; exit 1; }
PASSPHRASE=${1:-}
[ ${#PASSPHRASE} -ge 8 ] || {
  echo "usage: sudo $0 'passphrase'   (at least 8 characters)"
  exit 1
}

say "1. regulatory domain"
# Without a country set, the radio will not transmit on 5 GHz at all, and the
# hotspot silently comes up on 2.4 GHz - or not at all. This is the single most
# common reason "5 GHz does not work" on a Pi.
country=$(iw reg get 2>/dev/null | awk '/country/ {print $2; exit}' | tr -d ':')
if [ -z "$country" ] || [ "$country" = "00" ]; then
  echo "  no Wi-Fi country is set. Set it and run this again:"
  echo "      sudo raspi-config     # Localisation Options -> WLAN Country"
  exit 1
fi
echo "  country $country"
rfkill unblock wlan || true

say "2. the network"
nmcli connection delete "$NAME" >/dev/null 2>&1 || true
nmcli connection add type wifi ifname "$IFACE" con-name "$NAME" autoconnect yes ssid "$SSID"
nmcli connection modify "$NAME" \
  802-11-wireless.mode ap \
  802-11-wireless.band "$BAND" \
  802-11-wireless.channel "$CHANNEL" \
  wifi-sec.key-mgmt wpa-psk \
  wifi-sec.proto rsn \
  wifi-sec.pairwise ccmp \
  wifi-sec.psk "$PASSPHRASE" \
  ipv4.method shared \
  ipv4.addresses "$ADDRESS/24" \
  ipv6.method disabled
# ipv4.method shared is what makes NetworkManager hand out addresses and act as
# the gateway. There is no uplink to share, which is the point: a match runs
# with no route to the internet at all.
echo "  $SSID on ${BAND/a/5 GHz} channel $CHANNEL, vest at $ADDRESS"

say "3. tell the pairing code about the network just made"
# Everything an umpire needs is on one label, so the label has to be right: the
# network to join, its passphrase, the address to dial, and the signing key.
# This script is the only thing that knows the first two, because it is what
# created them.
set_env() {
  local key=$1 value=$2
  if grep -q "^$key=" /etc/thirdeye.env 2>/dev/null; then
    # The passphrase can contain anything, so use a delimiter it will not hold
    # and escape what sed would otherwise read as syntax.
    local escaped
    escaped=$(printf '%s' "$value" | sed -e 's/[\\&|]/\\&/g')
    sed -i "s|^$key=.*|$key=$escaped|" /etc/thirdeye.env
  else
    printf '%s=%s\n' "$key" "$value" >> /etc/thirdeye.env
  fi
}

# With the port. The service listens on 8000; an address without a port means
# 80, and the phone then fails to connect rather than being refused.
set_env THIRDEYE_ADVERTISE_HOST "$ADDRESS:8000"
set_env THIRDEYE_AP_SSID "$SSID"
set_env THIRDEYE_AP_PASSWORD "$PASSPHRASE"
echo "  the pairing code now carries $SSID at $ADDRESS:8000"
systemctl restart thirdeye 2>/dev/null || true

say "4. bringing it up - an SSH session over Wi-Fi ends here"
nmcli connection up "$NAME"

cat <<TEXT

  Now print the label that makes all of this hands-off. Run it once, tape the
  code to the vest, and an umpire never types anything again:

      sudo -u thirdeye /opt/thirdeye/vest/.venv/bin/python -m thirdeye.pairing \\
        | qrencode -o /tmp/pairing.png -s 8

  That code carries the network, its passphrase, the address and the signing
  key. Scanning it is the entire pairing procedure.

  To get back on your home Wi-Fi later:

      sudo nmcli connection down $NAME
      sudo nmcli connection modify $NAME autoconnect no
      sudo nmcli connection up <your home network>

  While the hotspot is up the Pi has no route to the internet, so apt will fail
  with a DNS error. Bring it down, install, bring it back up.

TEXT
