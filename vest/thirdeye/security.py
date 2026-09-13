"""Proving a request came from the paired phone.

Until now the vest's Wi-Fi password was the only thing standing between a
stranger and every clip on the device - and that password is printed on a code
taped to the vest, which anyone standing near the umpire can photograph. Joining
the network was the same thing as being allowed to download footage of people.

So every request carries a signature made with a key that is never displayed and
never travels over the link. The key reaches the phone once, inside the pairing
code, and lives in the phone's keystore after that.

The scheme is deliberately small:

    signature = HMAC-SHA256(key, method \\n path \\n timestamp \\n nonce)

A timestamp bounds how long a captured request stays useful, and a nonce stops
the same one being replayed inside that window. Neither is clever. Both are the
parts that are easy to leave out and expensive to add later.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from collections import OrderedDict
from pathlib import Path

log = logging.getLogger(__name__)

KEY_BYTES = 32
"""256 bits. The key is machine-generated and never typed by a person, so there
is no argument for making it shorter."""

MAX_SKEW_SECONDS = 300.0
"""How far a request's timestamp may be from the vest's clock.

Five minutes is generous, and deliberately so: the phone signs with its own
clock, which it has not necessarily reconciled with the vest's at the moment it
opens the connection. Tightening this buys very little - the nonce is what
actually stops replay - and costs a phone whose clock drifted the ability to
connect at all, in a field, with no way to fix it."""

NONCE_MEMORY = 4096
"""Nonces remembered, oldest dropped first. At two requests a delivery this is
many hours of match, and it is bounded so a flood cannot exhaust memory."""


def load_or_create_key(path: Path) -> str:
    """The vest's signing key, minted once and kept.

    Written with owner-only permissions. It is the one secret on the device:
    anyone holding it can ask for footage, so it is not logged, not served over
    the API, and reaches the phone only inside the pairing code.
    """
    if path.exists():
        key = path.read_text().strip()
        if len(key) == KEY_BYTES * 2:
            return key
        log.warning("%s does not contain a usable key; minting a new one", path)

    key = secrets.token_hex(KEY_BYTES)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(key)
    path.chmod(0o600)
    log.info("minted a new signing key at %s", path)
    return key


def sign(key: str, method: str, path: str, timestamp: str, nonce: str) -> str:
    """The signature for one request. The same function runs on the phone.

    The timestamp is a string, and signing it as a string is deliberate. The
    first version took a float and formatted it inside here, while the sender
    transmitted its own rendering of the same number - one rounded, one
    truncated - so a signature matched or did not depending on whether the
    fractional part happened to be over a half. Roughly half of all requests,
    failing for no visible reason.

    Signing exactly the bytes that go on the wire makes that class of bug
    impossible rather than unlikely.
    """
    message = f"{method.upper()}\n{path}\n{timestamp}\n{nonce}".encode()
    return hmac.new(bytes.fromhex(key), message, hashlib.sha256).hexdigest()


def now_stamp(now: float) -> str:
    """The timestamp as both sides render it: whole seconds, no decimal."""
    return str(int(now))


class Verifier:
    """Checks signatures, and remembers nonces so one cannot be used twice."""

    def __init__(self, key: str, *, required: bool = True) -> None:
        self.key = key
        self.required = required
        self._seen: OrderedDict[str, None] = OrderedDict()
        if not required:
            log.warning(
                "SIGNATURE CHECKING IS OFF. Any device on this network can "
                "download clips. Never run a real match like this."
            )

    def check(
        self,
        *,
        method: str,
        path: str,
        timestamp: str | None,
        nonce: str | None,
        signature: str | None,
        now: float,
    ) -> str | None:
        """Returns None when the request is good, or a reason when it is not.

        A reason rather than a bool because the reasons are worth logging: a
        refused request is either a bug in the phone or somebody trying, and
        those look different in a log.
        """
        if not self.required:
            return None

        if not (timestamp and nonce and signature):
            return "unsigned"

        try:
            sent_at = float(timestamp)
        except ValueError:
            return "bad timestamp"

        if abs(now - sent_at) > MAX_SKEW_SECONDS:
            return f"timestamp is {abs(now - sent_at):.0f}s away"

        # Verified against the string that arrived, not a re-rendering of it.
        expected = sign(self.key, method, path, timestamp, nonce)
        # compare_digest, not ==: an ordinary comparison returns faster on a
        # wrong first byte than a wrong last one, and that difference is enough
        # to recover a signature one byte at a time.
        if not hmac.compare_digest(expected, signature):
            return "signature does not match"

        if nonce in self._seen:
            return "nonce already used"

        self._seen[nonce] = None
        while len(self._seen) > NONCE_MEMORY:
            self._seen.popitem(last=False)
        return None
