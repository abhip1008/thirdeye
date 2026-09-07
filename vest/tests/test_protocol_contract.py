"""The contract test.

Both halves of the system parse the same fixture file. If a change to the schema
breaks the vest, this fails; if it breaks the phone, the TypeScript test fails.
Between them there is no way to ship a protocol change that only one side has
been told about.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError

from thirdeye.protocol import (
    PROTOCOL_VERSION,
    ClientMessage,
    ClipMeta,
    PairingPayload,
    ServerMessage,
)

FIXTURE = Path(__file__).resolve().parents[2] / "protocol" / "fixtures" / "protocol.v1.json"

server_adapter = TypeAdapter(ServerMessage)
client_adapter = TypeAdapter(ClientMessage)


@pytest.fixture(scope="module")
def fixture() -> dict:
    return json.loads(FIXTURE.read_text())


def test_fixture_exists() -> None:
    assert FIXTURE.exists(), f"golden fixture missing at {FIXTURE}"


def test_protocol_version_matches(fixture: dict) -> None:
    assert fixture["protocol_version"] == PROTOCOL_VERSION


def test_clip_meta_parses(fixture: dict) -> None:
    clip = ClipMeta.model_validate(fixture["clip_meta"])
    assert clip.seq == 9
    assert clip.closed_by == "button"
    # Nullable by design: the vest does not know the score.
    assert clip.over is not None


def test_every_server_message_parses(fixture: dict) -> None:
    seen = set()
    for raw in fixture["server_messages"]:
        message = server_adapter.validate_python(raw)
        seen.add(message.type)
    assert seen == {"hello", "clip_ready", "clip_expired", "session_state", "status", "pong"}


def test_every_client_message_parses(fixture: dict) -> None:
    seen = {client_adapter.validate_python(raw).type for raw in fixture["client_messages"]}
    assert seen == {"ack", "pin", "mark", "ping", "resync"}


def test_delivery_markers_carry_an_edge_and_a_vest_timestamp(fixture: dict) -> None:
    """The marker replaced the BLE remote. It is the one message the vest cannot
    guess at: without an edge it does not know which end of the delivery this is,
    and without a vest-clock timestamp it cannot find the footage in the buffer."""
    marks = [m for m in fixture["client_messages"] if m["type"] == "mark"]
    assert {m["edge"] for m in marks} == {"start", "end"}
    for raw in marks:
        message = client_adapter.validate_python(raw)
        assert message.at > 0
    # One of them is a replay held during an outage, which must parse the same way.
    assert any(m.get("queued") for m in marks)


def test_pairing_payload_parses(fixture: dict) -> None:
    payload = PairingPayload.model_validate(fixture["pairing_payload"])
    assert payload.host
    assert payload.psk is None


@pytest.mark.parametrize("key", ["missing_required_field", "unknown_message_type", "not_an_object"])
def test_rejected_server_shapes_are_rejected(fixture: dict, key: str) -> None:
    """A validator that accepts everything is worse than no validator."""
    with pytest.raises(ValidationError):
        server_adapter.validate_python(fixture["rejected"][key])


def test_a_marker_without_an_edge_is_rejected(fixture: dict) -> None:
    with pytest.raises(ValidationError):
        client_adapter.validate_python(fixture["rejected"]["mark_missing_edge"])
