"""Print the pairing payload, on purpose, to a terminal.

    python -m thirdeye.pairing

This is the one way the signing key leaves the vest. It is not a route, because
a route that hands out the key can be called by whoever is asking; it is not in
the startup log, because a log is copied into bug reports. It is a command
somebody with a shell on the vest runs, and what it prints is exactly what the
QR code taped to the vest should contain.

Piping it into a QR encoder is the intended use:

    python -m thirdeye.pairing | qrencode -o pairing.png
"""

from __future__ import annotations

import json
import sys

from .main import pairing_payload


def main() -> int:
    payload = pairing_payload()
    # Compact, because it is going into a QR code: every character is a module,
    # and a payload with spaces in it is a denser code to read in the sun.
    json.dump(payload, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
