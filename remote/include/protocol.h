// Third Eye remote-to-vest wire format.
//
// This is the C mirror of the BLE section of
// protocol/schema/protocol.v1.json. It is the one file that has to exist in
// Phase 1; the firmware itself is Phase 5.
//
// Keep the layout in step with the schema by hand - seven bytes is small enough
// that a generator would cost more than it saves - but change both or neither.

#pragma once

#include <stdint.h>

#define THIRDEYE_PROTOCOL_VERSION 1

// Nordic UART-style base UUIDs, reused because every BLE tool on a laptop
// already recognises them, which matters when debugging in a car park.
#define THIRDEYE_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define THIRDEYE_CONFIG_CHAR_UUID "6e400002-b5a3-f393-e0a9-e50e24dcca9e"  // write
#define THIRDEYE_EVENT_CHAR_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e"   // notify

typedef enum : uint8_t {
  THIRDEYE_EVENT_START = 0x01,
  THIRDEYE_EVENT_END = 0x02,
  THIRDEYE_EVENT_HEARTBEAT = 0x03,
} thirdeye_event_t;

typedef enum : uint8_t {
  THIRDEYE_FLAG_LOW_BATTERY = 1 << 0,
  THIRDEYE_FLAG_JUST_WOKE = 1 << 1,
} thirdeye_flag_t;

// Seven bytes, little-endian, sent as one GATT notification.
//
// `counter` increments on every event including heartbeats. It is how the vest
// notices a dropped notification: a jump of more than one means a press was
// lost, which is logged and surfaced in health rather than silently ignored.
typedef struct __attribute__((packed)) {
  uint8_t event;        // thirdeye_event_t
  uint32_t counter;     // monotonic, wraps at 2^32
  uint8_t battery_pct;  // 0 to 100
  uint8_t flags;        // thirdeye_flag_t bitfield
} thirdeye_event_payload_t;

_Static_assert(sizeof(thirdeye_event_payload_t) == 7, "event payload must be exactly 7 bytes");

// Debounce in firmware, not on the vest, so a bouncing switch never reaches the
// radio. Two seconds: a legitimate START and END cannot be closer than that.
#define THIRDEYE_DEBOUNCE_MS 2000

// Heartbeat while idle, so the vest can warn on a flat remote before the over
// in which it dies rather than after it.
#define THIRDEYE_HEARTBEAT_MS 10000
