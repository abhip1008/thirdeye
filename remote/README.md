# thirdeye-remote

Two buttons in the umpire's hand. START as the bowler turns, END when the ball
is dead. That is the entire user interface, and it is the reason the system
needs no operator: the presses happen with the hand that is already counting.

An ESP32-C3 acts as a BLE peripheral; the vest is the central. Button events go
out as GATT notifications, seven bytes each.

## Status

Phase 1: `include/protocol.h` only. Firmware is Phase 5.

## Build

```bash
pio run                # build
pio run -t upload      # flash
pio device monitor     # serial log
```

## Protocol

`include/protocol.h` mirrors the BLE section of
`../protocol/schema/protocol.v1.json`. Change both together.
