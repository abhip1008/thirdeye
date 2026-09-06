# Third Eye

**An umpire-worn replay system for club cricket.**

Version 0.1 · Draft spec and build plan

---

## Table of contents

1. [What we are building](#1-what-we-are-building)
2. [Scope and non-goals](#2-scope-and-non-goals)
3. [System overview](#3-system-overview)
4. [Hardware](#4-hardware)
5. [Technology stack](#5-technology-stack)
6. [Repository layout](#6-repository-layout)
7. [Data contracts](#7-data-contracts)
8. [Phase plan](#8-phase-plan)
9. [Phase 1 in detail (today)](#9-phase-1-in-detail-today)
10. [Phase 2 to 8](#10-phase-2-to-8)
11. [Risks and open questions](#11-risks-and-open-questions)
12. [Glossary](#12-glossary)
13. [Appendix: command cheat sheet](#13-appendix-command-cheat-sheet)

---

## 1. What we are building

Third Eye is a rolling per-delivery replay buffer worn by a cricket umpire, plus a phone app that lets them review the last 12 balls within seconds of an appeal.

The umpire wears a vest containing a camera and a small Linux computer. A two-button remote in their hand marks the start and end of each delivery. Each ball becomes a short video clip that is pushed to the umpire's phone during the gap before the next ball. When a review is called, the clip is already on the phone. There is nothing to download and nothing to wait for.

Clips older than 12 balls are deleted automatically unless someone reviewed them or a wicket fell.

### The one-sentence version

> The umpire's own eyes, on rewind, with nothing kept.

### Why it might work

Three properties make this different from pointing a phone at the game:

| Property | Why it matters |
|---|---|
| **Zero operator burden** | Nobody starts or stops a recording. Two button presses per ball, done with the hand that is already counting. |
| **Zero wait at review time** | The transfer happens in the 30 to 40 seconds between deliveries, not while eleven fielders watch a progress bar. |
| **Nothing is kept** | Auto-purge after 12 balls answers the privacy objection, the storage cost, and the "are you filming me" conversation, all at once. |

### What it will actually resolve

Be honest about this in every pitch. A chest camera at the bowler's end sees the stumps at roughly 19 pixels wide from 20 metres with a 66 degree lens. It will **not** resolve a marginal LBW. There is no ball tracking, no projection, no snicko.

What it does resolve well:

- **Front-foot no-balls.** The popping crease is 1 to 2 metres from the camera. Highest pixel density in the frame, fully objective call.
- **Gross LBW errors.** Pitched a foot outside leg. Struck above the knee roll. Big inside edge. Struck miles outside the line.
- **Run-outs at the bowler's end.**
- **The umpire's own memory.** Half the value is "let me look at that again" instead of "I'm fairly sure."

Sell the no-ball and the gross-error case. Do not sell DRS.

---

## 2. Scope and non-goals

### In scope for v1

- One vest unit on the bowler's-end umpire
- One paired phone running the review app
- One BLE remote
- 12-ball rolling buffer with automatic purge
- Manual pinning of clips (wickets, reviews)
- Post-match sync of pinned clips only

### Explicitly out of scope for v1

| Not doing | Why |
|---|---|
| Ball tracking or trajectory projection | Optically impossible at this pixel density |
| Snicko or edge detection from audio | Microphone is 20 m from the bat |
| Live streaming to spectators | Different product, different bandwidth budget |
| Automatic ball detection from video | No dataset exists for chest-cam POV. The remote solves it instead. |
| Two vest units (square leg as well) | v2. The architecture supports it, we are not building it yet. |
| Scorer integration (CricClubs) | v2. Nice for labelling clips, not needed to function. |
| iOS | v2. Android first, see risk register. |

### Success criteria for v1

1. An umpire can review any of the last 12 balls in under 15 seconds from reaching for the phone.
2. Over a full innings, fewer than 2% of deliveries end with a missing clip.
3. The vest runs 3 hours on one battery charge without thermal throttling.
4. An umpire who has never seen it can be trained to use it in under 5 minutes.

---

## 3. System overview

Four tiers, left to right.

```
  UMPIRE            ON-BODY UNIT                LINK              REVIEW APP           AFTER MATCH
    |                                                                                  (offline
    |                                                                                   during play)
  [Remote] --BLE--> [ ROCK 5C + AR0234 ]  ==Wi-Fi==>  [ Android phone ]  ------>  [ Cloud ]
                     - GStreamer capture   CONTROL     - React Native              - FastAPI
                     - Pre-roll ring       (WebSocket) - SQLite                    - Postgres
                     - Clip cutter         FILES       - 12-clip store             - Supabase
                     - FastAPI + nginx     (HTTP)      - Review player               storage
```

### The per-ball cycle

```
t=0s    Umpire presses START as the bowler turns
        Clip opens, reaching 3 seconds back into the pre-roll ring
t=12s   Ball is dead. Umpire presses END.
        Clip closes. File is already valid (fragmented MP4).
t=12.3s ROCK computes size + SHA-256, writes metadata JSON
t=12.4s WebSocket: {"type":"clip_ready","seq":9,...}
t=15s   Phone has finished downloading 9.5 MB over HTTP
        Phone verifies hash, renames .part to .mp4, sends ack
t=15.1s Camera marks clip 9 as delivered, may now purge clip -3
t=40s   Next ball
```

The transfer uses 3 of the 30 to 40 available seconds. That is the whole design.

### The review moment

```
0s    Appeal. Umpire decides to review.
1s    Opens app. Already connected, has been since the toss.
2s    Sees 12 clips with status dots. Taps ball 9.
2s    Plays instantly. Nothing downloads.
2-70s Watches, slows down, steps frames.
85s   Confers with square leg umpire.
90s   Signals the decision.
```

Technology consumes about 2 seconds of the 120. Everything else is the umpire looking at the ball, which is the part that must not be rushed.

---

## 4. Hardware

### Bill of materials, one vest unit

| Item | Part | Approx cost | Notes |
|---|---|---|---|
| Compute | Radxa ROCK 5C (RK3588S2), 8 GB | $110 | Hardware H.264/H.265 encoder on-die |
| Camera | AR0234 global-shutter USB3 UVC module | $90 to $150 | 1920x1200, global shutter, 60 to 120 fps |
| Lens | ~66 degree HFOV, C/CS or M12 | $25 | **Do not use a wide-angle lens**, see optics note |
| Storage | NVMe SSD, 256 GB, M.2 2242 | $30 | Sustained write matters more than capacity |
| Wi-Fi | Onboard, or M.2 E-key module | $0 to $20 | **Must support 5 GHz AP mode**, verify before buying |
| Power | USB-C PD power bank, 20000 mAh | $35 | ROCK 5C draws 5 to 10 W under encode load |
| Remote | ESP32-C3 devkit + 2 tactile buttons + LiPo | $12 | BLE 5.0, no Bluetooth Classic |
| Harness | Chest mount with printed tray | $45 | GoPro Chesty style |
| Enclosure | Printed PETG, IP54, optical window | $15 | It rains here |
| **Total** | | **~$375 to $440** | |

Plus a phone. Strongly recommend a **league-owned Android phone** rather than the umpire's own, see [risks](#11-risks-and-open-questions).

### Optics note

This determines whether the product works, so it is worth stating plainly.

At 20 metres with a 1920px-wide sensor:

| Horizontal FOV | Stumps (22.9 cm) | Ball (7.2 cm) |
|---|---|---|
| 120 degrees (action-cam wide) | ~8 px | ~2 px |
| 90 degrees (linear) | ~14 px | ~4 px |
| **66 degrees (chosen)** | **~19 px** | **~6 px** |
| 45 degrees | ~28 px | ~9 px |

Narrower is better for the impact zone but loses peripheral awareness and makes aiming harder. 66 degrees is the compromise. Test 45 degrees in the field before committing.

### Why the AR0234 is the right call

Global shutter. A rolling-shutter CMOS sensor skews fast-moving objects, and a cricket ball at 30 m/s moves a metre between frames at 30 fps. Global shutter removes the skew entirely. This was the single biggest hardware risk in the original plan and choosing this sensor closes it.

### USB bandwidth reality check

USB 3.0 gives roughly 450 MB/s practical throughput.

| Mode | Raw bandwidth | Fits? |
|---|---|---|
| 1920x1200 UYVY @ 60 fps | 276 MB/s | Yes |
| 1920x1200 UYVY @ 120 fps | 553 MB/s | **No** |
| 1920x1200 MJPEG @ 120 fps | ~90 MB/s | Yes, but adds a decode step |

**Decide this in Phase 2.** If 120 fps matters, you are on MJPEG and the ROCK must decode before re-encoding, which costs CPU. If 60 fps is enough, take UYVY and go straight to the hardware encoder.

---

## 5. Technology stack

### Summary

| Tier | Language | Framework | Runs on |
|---|---|---|---|
| Remote | C++ | PlatformIO + ESP-IDF (NimBLE) | ESP32-C3 |
| Vest | Python 3.11 | FastAPI, GStreamer, nginx | ROCK 5C, Debian |
| Mobile | TypeScript | React Native (Expo), Zustand | Android |
| Cloud | Python 3.11 | FastAPI, Postgres, Supabase | Anywhere |

### Tier 1: Remote (ESP32-C3)

| Choice | Rationale | Flag |
|---|---|---|
| **PlatformIO in VS Code** | Right call over Arduino IDE. Proper dependency management, real build config, works as the project grows. | |
| **C++ / ESP-IDF** | Native SDK, full control over sleep and BLE. Arduino-on-ESP32 also works and is faster to start. | Start with the Arduino framework under PlatformIO for speed, migrate to ESP-IDF if you need deep sleep tuning. |
| **NimBLE** | ESP32-C3 supports **BLE 5.0 only, no Bluetooth Classic.** NimBLE is the lighter stack. | ⚠️ Your notes say "Bluetooth (BlueZ)". BlueZ is the *Linux* side. The ESP32 side is NimBLE. Two different halves of the same link. |
| **GATT notify** | Push button events to the ROCK with no polling. Lowest latency, lowest power. | |

### Tier 2: Vest (ROCK 5C)

| Choice | Rationale | Flag |
|---|---|---|
| **Debian (Radxa image)** | Rockchip BSP kernel has the VPU drivers. Mainline Debian does not, yet. | ⚠️ Use the Radxa-provided image, not vanilla Debian, or you lose hardware encoding. |
| **hostapd + dnsmasq** | Standard, well documented, total control. | ⚠️ Must disable NetworkManager's management of the AP interface or they will fight. |
| **V4L2** | Correct. UVC cameras present as `/dev/videoN` with no custom driver. | |
| **GStreamer** | Correct choice. Handles capture, encode, mux, and segmenting in one pipeline. | Encoder element is either `mpph265enc` (Rockchip MPP) or `v4l2h265enc` (V4L2 M2M). **Verify which one exists on your image in Phase 2.** |
| **FastAPI + uvicorn** | WebSocket and REST in one process, async, good typing. | |
| **nginx** | Serves MP4 files with byte-range support and `sendfile`, far faster than FastAPI for static files. Reverse-proxies `/api` and `/ws` to uvicorn. | |
| **bleak** | Python BLE client, uses BlueZ over D-Bus. Runs as a small service that translates GATT notifications into internal events. | |
| **systemd** | Every service gets a unit with `Restart=always` and a watchdog. This thing has to survive rain and reboots unattended. | |

### Tier 3: Mobile (React Native)

| Choice | Rationale | Flag |
|---|---|---|
| **React Native + TypeScript** | One codebase, and you already know the ecosystem. | |
| **Expo with development builds** | Not bare RN, not Expo Go. Dev builds give you native modules plus Expo's tooling. | Expo Go will not work, you need native networking config. |
| **Zustand** | Right call. Lightweight, no boilerplate, no provider tree. | |
| **expo-sqlite** | Local clip index, review log, match state. | `op-sqlite` is faster if you hit limits, but start here. |
| **react-native-video (v6)** | Wraps ExoPlayer/Media3 on Android and AVPlayer on iOS. | ⚠️ Frame-accurate stepping is the hard part. Budget real time for it. |
| **expo-file-system** | `createDownloadResumable` gives pause/resume with a token. | ⚠️ May not expose HTTP `Range` precisely. If not, drop to a small native module wrapping OkHttp. Decide in Phase 3. |
| **expo-camera** | QR code scanning for pairing. | |
| **react-native-svg** | Draggable stump-line and bail-height overlays on the player. | |

### Tier 4: Cloud (tentative)

| Choice | Rationale | Flag |
|---|---|---|
| **FastAPI** | Same language and idioms as the vest. One less thing to context-switch on. | |
| **Postgres** | Review metadata, match records, audit log. | |
| **Supabase** | Storage plus auth plus a Postgres instance in one. Fast to stand up. | You can also just use Supabase Storage and self-host the API. Decide in Phase 8. |

**Everything in tier 4 is optional for match day.** If the entire cloud is down, a match runs identically. Keep it that way.

### Where the stack has a gap

**HTTPS on a LAN with a raw IP.** Your notes say the phone downloads over HTTPS from `http://192.168.43.1`. You cannot get a real certificate for a private IP. Three options:

1. **Plain HTTP.** Fine on a point-to-point link with no router, but Android blocks cleartext by default. You need a `network_security_config.xml` exception for that specific IP.
2. **Self-signed cert pinned in the app.** More work, removes the cleartext exception, arguably overkill for a link that has one client.
3. **HTTP plus an app-level shared secret.** Sign requests with an HMAC derived from the QR pairing payload. Prevents another phone on the same AP from pulling clips.

**Recommendation:** option 1 for Phase 3, option 3 before any real match. Document the decision either way.

---

## 6. Repository layout

Four repositories, as planned. A monorepo would also work, but four repos keeps CI simple and lets the ESP32 firmware live on its own release cycle.

### `thirdeye-remote` — C++ / PlatformIO

```
thirdeye-remote/
├── platformio.ini
├── include/
│   ├── config.h              # GPIO pins, UUIDs, timings
│   └── protocol.h            # Shared event byte format
├── src/
│   ├── main.cpp
│   ├── ble_service.cpp       # GATT server, notify characteristic
│   ├── buttons.cpp           # Debounce, edge detect
│   ├── power.cpp             # Deep sleep, GPIO wake, battery ADC
│   └── led.cpp               # Status LED patterns
├── test/
└── README.md
```

### `thirdeye-vest` — Python

```
thirdeye-vest/
├── pyproject.toml
├── thirdeye/
│   ├── __init__.py
│   ├── main.py               # FastAPI app entrypoint
│   ├── config.py             # Pydantic settings, env-driven
│   ├── api/
│   │   ├── routes_clips.py
│   │   ├── routes_session.py
│   │   ├── routes_status.py
│   │   └── ws.py             # WebSocket hub
│   ├── capture/
│   │   ├── pipeline.py       # GStreamer pipeline construction
│   │   ├── preroll.py        # tmpfs ring buffer janitor
│   │   └── cutter.py         # Segment selection + ffmpeg concat
│   ├── remote/
│   │   ├── ble_listener.py   # bleak client, GATT subscribe
│   │   └── state_machine.py  # Idle / recording / timeout
│   ├── storage/
│   │   ├── clip_store.py     # Write, hash, metadata JSON
│   │   └── retention.py      # 12-clip ring, ack tracking
│   ├── health/
│   │   └── monitor.py        # Battery, temp, disk, fps
│   └── models.py             # Pydantic models shared with API
├── deploy/
│   ├── hostapd.conf
│   ├── dnsmasq.conf
│   ├── nginx/thirdeye.conf
│   ├── systemd/
│   │   ├── thirdeye-api.service
│   │   ├── thirdeye-capture.service
│   │   └── thirdeye-ble.service
│   └── setup.sh              # One-shot provisioning script
├── scripts/
│   ├── make_qr.py            # Generate the pairing QR
│   └── bench_encoder.py      # Phase 2 encoder verification
├── tests/
└── README.md
```

### `thirdeye-mobile` — React Native + TypeScript

```
thirdeye-mobile/
├── app.json
├── package.json
├── tsconfig.json
├── src/
│   ├── app/                      # expo-router screens
│   │   ├── _layout.tsx
│   │   ├── index.tsx             # Pair / connect
│   │   ├── setup.tsx             # Match setup
│   │   ├── live.tsx              # Main clip list  ← the important one
│   │   ├── clip/[seq].tsx        # Review player
│   │   ├── summary.tsx           # End of match
│   │   └── settings.tsx
│   ├── components/
│   │   ├── ConnectionPill.tsx
│   │   ├── ClipRow.tsx
│   │   ├── StatusDot.tsx
│   │   ├── BallCounter.tsx
│   │   ├── PlayerControls.tsx
│   │   ├── SpeedSelector.tsx
│   │   ├── FrameStepper.tsx
│   │   ├── OverlayCanvas.tsx
│   │   ├── PinButton.tsx
│   │   └── EmptyState.tsx
│   ├── stores/
│   │   ├── connectionStore.ts
│   │   ├── clipStore.ts
│   │   ├── matchStore.ts
│   │   └── settingsStore.ts
│   ├── db/
│   │   ├── schema.sql
│   │   ├── migrations.ts
│   │   └── queries.ts
│   ├── net/
│   │   ├── wsClient.ts
│   │   ├── httpClient.ts
│   │   ├── downloadQueue.ts
│   │   └── verify.ts
│   ├── mock/
│   │   ├── mockClips.ts          # Phase 1 fixture data
│   │   └── mockServer.ts         # Fake WS + HTTP for UI dev
│   ├── theme/
│   │   ├── colors.ts
│   │   ├── spacing.ts
│   │   └── typography.ts
│   └── types/
│       └── protocol.ts           # Shared with vest, keep in sync
├── assets/
└── README.md
```

### `thirdeye-cloud` — Python + FastAPI

```
thirdeye-cloud/
├── pyproject.toml
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── matches.py
│   │   ├── clips.py
│   │   └── auth.py
│   ├── db/
│   │   ├── models.py
│   │   └── migrations/
│   └── storage/
│       └── supabase_client.py
├── docker-compose.yml
└── README.md
```

### Keeping the protocol in sync

`thirdeye-vest/thirdeye/models.py` and `thirdeye-mobile/src/types/protocol.ts` describe the same messages in two languages. Options:

1. **Manual, with a test.** Simplest. Write a contract test in each repo that asserts against a checked-in JSON fixture. Both repos have the same fixture file.
2. **Generate TS from the OpenAPI schema.** FastAPI emits OpenAPI for free. `openapi-typescript` turns it into TS types. Add it as a CI step.

**Recommendation:** start with option 1 in Phase 1, add option 2 in Phase 3 when the API is real.

---

## 7. Data contracts

These are the interfaces between tiers. Get them right early and each tier can be built independently.

### 7.1 Clip identity and files

A clip is identified by `(match_id, seq)`. `seq` is a monotonic counter of **deliveries**, not legal balls, so wides and no-balls get their own clip.

On the vest:

```
/data/matches/{match_id}/
├── match.json                    # Match metadata
├── clips/
│   ├── clip_0009.mp4             # Review copy, 1080p, 5 Mbps H.265
│   └── clip_0009.json            # Metadata sidecar
└── archive/
    └── clip_0009.mp4             # Archive copy, 1080p60, 15 Mbps

/dev/shm/preroll/                 # tmpfs, the ring buffer
├── seg_00412.mp4                 # 1-second fragments
├── seg_00413.mp4
└── ...                           # Janitor deletes anything older than 20 s
```

On the phone (app-private storage, **not** the camera roll):

```
{FileSystem.documentDirectory}/matches/{match_id}/
├── clip_0009.mp4                 # Verified, committed
├── clip_0010.mp4.part            # In flight, ignored by the UI
└── thumbs/
    └── clip_0009.jpg
```

The `.part` suffix is the commit mechanism. A file without it is guaranteed complete and hash-verified. A crash mid-download can never leave a broken clip that looks fine.

### 7.2 Clip metadata (`clip_0009.json`)

```json
{
  "v": 1,
  "match_id": "2026-09-06-nwcl-div2-marymoor",
  "seq": 9,
  "camera_id": "vest-01",
  "started_at": 1757193021.220,
  "ended_at":   1757193036.480,
  "duration_s": 15.26,
  "preroll_s": 3.0,
  "closed_by": "button",
  "resolution": "1920x1200",
  "fps": 60,
  "codec": "h265",
  "bytes": 9540221,
  "sha256": "3f9a2c...",
  "archive_bytes": 28620663,
  "over": 2,
  "ball_in_over": 3,
  "legal": true
}
```

`closed_by` is one of:

| Value | Meaning | UI treatment |
|---|---|---|
| `button` | Normal. END press received. | No marker |
| `timeout` | 40 s elapsed with no END press. | Small clock icon, clip may be truncated |
| `recovered` | END received with no preceding START. Pulled from the ring. | Small warning icon, boundaries approximate |
| `manual` | Umpire hit "grab last 20 seconds" in the app. | Small hand icon |

`over` and `ball_in_over` are **nullable**. The vest does not know the score. The phone fills these in from the ball index if the umpire is tracking, otherwise the clip is identified by `seq` alone.

### 7.3 REST API (vest)

Base URL `http://192.168.43.1`. All `/api` routes are FastAPI. `/clips` is served directly by nginx.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness. Returns `{"ok":true,"uptime_s":N}` |
| `GET` | `/api/status` | Battery, temperature, disk free, encoder fps, session state |
| `POST` | `/api/session/start` | Begin a match. Body: `{"name":"...","venue":"..."}`. Returns `match_id` |
| `POST` | `/api/session/end` | End the match. Purges unpinned clips. |
| `GET` | `/api/session` | Current session or `null` |
| `GET` | `/api/clips` | List clips in the current ring. Returns array of metadata objects. |
| `GET` | `/api/clips/{seq}/meta` | One clip's metadata |
| `GET` | `/clips/{seq}.mp4` | **nginx.** The file, with `Accept-Ranges: bytes` |
| `POST` | `/api/clips/{seq}/ack` | Body: `{"sha256":"..."}`. Marks delivered. |
| `POST` | `/api/clips/{seq}/pin` | Body: `{"pinned":true,"reason":"wicket"}`. Exempts from purge. |
| `POST` | `/api/clips/recover` | Cut a clip from the last 20 s of ring buffer. Returns new `seq`. |
| `WS` | `/ws` | The control channel |

**nginx config sketch** (`deploy/nginx/thirdeye.conf`):

```nginx
server {
    listen 80;
    server_name _;

    location /clips/ {
        alias /data/matches/current/clips/;
        add_header Accept-Ranges bytes;
        sendfile on;
        tcp_nopush on;
        # 12-clip ring, never cache
        add_header Cache-Control "no-store";
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;   # match-length connections
    }
}
```

That `proxy_read_timeout` matters. The default is 60 seconds and it will silently kill your always-open WebSocket between overs.

### 7.4 WebSocket protocol

Every message is JSON with a `type` and a `v` (protocol version). Unknown types are ignored, not errors, so either side can be upgraded independently.

**Server to client:**

```jsonc
// On connect
{"v":1,"type":"hello","camera_id":"vest-01","match_id":"...","seq_latest":9,
 "protocol":1,"firmware":"0.1.0"}

// A clip is ready to fetch
{"v":1,"type":"clip_ready","seq":9,"bytes":9540221,"sha256":"3f9a2c...",
 "duration_s":15.26,"closed_by":"button"}

// A clip has rolled out of the ring and is gone
{"v":1,"type":"clip_expired","seq":-3}

// Recording state changed (drives the LED and the app's ball counter)
{"v":1,"type":"session_state","state":"recording","seq":10,"since":1757193045.1}

// Periodic health, every 10 s
{"v":1,"type":"status","battery_pct":62,"temp_c":51.2,"disk_free_gb":180,
 "encoder_fps":59.9,"clips_held":12}

{"v":1,"type":"pong","t":1757193045.1}
```

**Client to server:**

```jsonc
{"v":1,"type":"ack","seq":9,"sha256":"3f9a2c..."}
{"v":1,"type":"pin","seq":9,"pinned":true,"reason":"wicket"}
{"v":1,"type":"ping","t":1757193045.1}
{"v":1,"type":"resync","since_seq":4}   // after a reconnect: "what did I miss?"
```

**Heartbeat rule:** both sides send `ping` every 5 seconds. Three missed pongs means the link is considered down. The phone shows amber and starts reconnecting with exponential backoff capped at 10 seconds.

**Reconnect rule:** on reconnect the phone sends `resync` with the highest `seq` it has committed. The vest replies with a `clip_ready` for every clip since then that it still holds. This is how a two-over Wi-Fi outage recovers with nothing lost.

### 7.5 BLE protocol (remote to vest)

Custom GATT service. The ESP32-C3 is the peripheral, the ROCK is the central.

```
Service UUID:          6e400001-b5a3-f393-e0a9-e50e24dcca9e
Event characteristic:  6e400003-b5a3-f393-e0a9-e50e24dcca9e   (notify)
Config characteristic: 6e400002-b5a3-f393-e0a9-e50e24dcca9e   (write)
```

**Event payload, 7 bytes, little-endian:**

| Offset | Size | Field | Values |
|---|---|---|---|
| 0 | 1 | `event` | `0x01` START, `0x02` END, `0x03` HEARTBEAT |
| 1 | 4 | `counter` | Monotonic, increments on every event including heartbeats |
| 5 | 1 | `battery_pct` | 0 to 100 |
| 6 | 1 | `flags` | bit 0: low battery, bit 1: just woke from sleep |

The `counter` is how the vest detects a dropped BLE notification. If it jumps by more than one, log it and surface it in the health status.

**Heartbeat every 10 seconds** even when idle, so the vest knows the remote is alive and can warn on battery.

**Debounce:** ignore any event within 2 seconds of the previous one. Do this in the firmware, not on the ROCK, so a bouncing switch does not spam BLE.

### 7.6 Session state machine (vest)

This is the most important logic in the system. Both recovery paths must be built from day one, not bolted on.

| Event | State | Action | New state |
|---|---|---|---|
| START | Idle | Open clip, reach 3 s back into ring | Recording |
| END | Recording | Close clip, hash, announce | Idle |
| **START** | **Recording** | END was missed. Close current clip now, immediately open a new one. | Recording |
| **END** | **Idle** | START was missed. Cut a clip from the last 20 s of ring, flag `recovered`. | Idle |
| 40 s elapsed | Recording | Auto-close, flag `timeout` | Idle |
| Any event within 2 s of last | Any | Ignore (debounce) | unchanged |
| BLE disconnect | Recording | Keep recording. Rely on the 40 s timeout. | Recording |

**On the 40 second timeout:** your notes said 25. Use 40. A realistic worst case is run-up 8 s + delivery 1 s + batter runs three at 15 s + throw and settle at 5 s = about 29 seconds of legitimate live ball. A 25 s timeout truncates real deliveries, including the run-outs and overthrows people argue about. A 40 s clip is 25 MB and still transfers inside the gap. The cost of 40 is nothing, the cost of 25 is lost evidence.

### 7.7 Phone SQLite schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE matches (
  id            TEXT PRIMARY KEY,          -- match_id from the vest
  name          TEXT NOT NULL,
  venue         TEXT,
  camera_id     TEXT NOT NULL,
  started_at    REAL NOT NULL,
  ended_at      REAL,
  synced_at     REAL
);

CREATE TABLE clips (
  match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  over          INTEGER,
  ball_in_over  INTEGER,
  legal         INTEGER DEFAULT 1,
  started_at    REAL NOT NULL,
  ended_at      REAL NOT NULL,
  duration_s    REAL NOT NULL,
  bytes         INTEGER NOT NULL,
  sha256        TEXT NOT NULL,
  closed_by     TEXT NOT NULL,             -- button|timeout|recovered|manual
  status        TEXT NOT NULL,             -- announced|downloading|verifying|ready|failed|expired
  bytes_local   INTEGER DEFAULT 0,         -- for resume: how much of .part we have
  local_path    TEXT,
  thumb_path    TEXT,
  pinned        INTEGER DEFAULT 0,
  pin_reason    TEXT,
  reviewed      INTEGER DEFAULT 0,
  downloaded_at REAL,
  attempts      INTEGER DEFAULT 0,
  last_error    TEXT,
  PRIMARY KEY (match_id, seq)
);

CREATE INDEX idx_clips_status ON clips(match_id, status);
CREATE INDEX idx_clips_seq    ON clips(match_id, seq DESC);

CREATE TABLE reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      TEXT NOT NULL,
  seq           INTEGER NOT NULL,
  called_at     REAL NOT NULL,
  appeal_type   TEXT,                      -- lbw|caught|runout|stumping|noball|other
  decision      TEXT,                      -- out|not_out|inconclusive
  notes         TEXT,
  FOREIGN KEY (match_id, seq) REFERENCES clips(match_id, seq)
);

CREATE TABLE events (                       -- audit log, useful in testing
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      TEXT,
  ts            REAL NOT NULL,
  type          TEXT NOT NULL,
  payload       TEXT
);
```

`bytes_local` is what makes resume work with no in-memory session state. On app restart, `stat` the `.part` file, compare, and issue `Range: bytes={bytes_local}-`.

### 7.8 Clip status lifecycle

```
announced ──► downloading ──► verifying ──► ready
                   │              │
                   │              └──► failed ──┐
                   └──► failed ────────────────┤
                                               ▼
                                          (retry queue)
                                               │
                                               ▼
                                    expired (rolled out of ring)
```

| Status | Dot | Umpire can tap? |
|---|---|---|
| `ready` | 🟢 green | Yes, plays instantly |
| `downloading` / `verifying` / `announced` | 🟡 amber | Yes, but shows a progress state |
| `failed` / `expired` | ⚪ grey | No, shows why |

**The status dot is a real feature, not decoration.** The umpire must be able to see that a clip exists *before* announcing a review. Announcing a review and then discovering a grey dot is the single worst thing that can happen to this product on the field.

---

## 8. Phase plan

Each phase ends with something you can demonstrate. If a phase does not produce a thing you can show someone, it is scoped wrong.

| Phase | Name | Duration | Ends when |
|---|---|---|---|
| **0** | Decisions and procurement | Before you start | Hardware ordered, accounts created, decisions in §11 answered |
| **1** | **Foundations and UI** | **Today** | **All four repos exist, mobile app runs on a device with every screen working against mock data** |
| 2 | Vest brings up | 2 to 3 days | ROCK boots, makes its own Wi-Fi, camera records to disk with hardware encoding |
| 3 | The link | 2 days | Phone connects to the real vest over Wi-Fi, WebSocket stays open, downloads a real file |
| 4 | Clipping and pre-roll | 3 days | A fake button press produces a correctly-bounded clip with 3 s of pre-roll |
| 5 | The remote | 2 days | Real ESP32, real buttons, full state machine including both recovery paths |
| 6 | Hardening | 3 days | Retry, resume, retention, health monitoring, survives a pulled cable |
| 7 | Field trial | 1 match day + 2 days of fixes | Two overs of a real fixture, measured miss rate |
| 8 | Cloud | 2 days | Pinned clips upload after the match |

Phases 2 and 5 can run in parallel with 3 and 4 if two people are working.

---

## 9. Phase 1 in detail (today)

**Goal: every repository exists and is buildable, and the mobile app runs on a real Android device with every screen working against mock data.**

At the end of today you should be able to hand someone your phone, have them tap through the whole umpire flow, and have them understand the product. No hardware, no network, no camera. Just the experience.

### 9.0 Order of work

Do it in this order. The scaffolding is fast, the UI is where the day goes.

```
09:00  Repos and tooling            (§9.1)   ~45 min
09:45  Shared protocol types        (§9.2)   ~30 min
10:15  Mobile scaffold + theme      (§9.3)   ~45 min
11:00  Zustand stores + mock data   (§9.4)   ~60 min
12:00  Screens: pair, setup         (§9.5)   ~45 min
13:00  Screen: live (the big one)   (§9.6)   ~2 hr
15:00  Screen: review player        (§9.7)   ~2 hr
17:00  Screens: summary, settings   (§9.8)   ~45 min
17:45  Run on device, walk through  (§9.9)   ~30 min
```

If you run out of time, cut §9.8 and the overlays in §9.7. Do not cut the status dots in §9.6, they are the point.

### 9.1 Repos and tooling

**Create four repos.** Private to start.

```bash
gh repo create thirdeye-remote --private --clone
gh repo create thirdeye-vest   --private --clone
gh repo create thirdeye-mobile --private --clone
gh repo create thirdeye-cloud  --private --clone
```

**Each repo gets, minimum:**

- `README.md` with a one-paragraph description and a "how to run" section
- `.gitignore` appropriate to the language
- `.editorconfig` (2 spaces TS, 4 spaces Python, LF endings)
- A `LICENSE` if you have decided on one, `UNLICENSED` if not

**`thirdeye-remote` scaffold:**

```bash
cd thirdeye-remote
pio project init --board esp32-c3-devkitm-1 --project-option "framework=arduino"
```

`platformio.ini`:

```ini
[env:esp32-c3-devkitm-1]
platform = espressif32
board = esp32-c3-devkitm-1
framework = arduino
monitor_speed = 115200
lib_deps =
    h2zero/NimBLE-Arduino@^1.4.1
build_flags =
    -DCORE_DEBUG_LEVEL=3
```

Write `include/protocol.h` today with the 7-byte event struct from §7.5. That is the only file that has to exist. Do not write firmware today.

**`thirdeye-vest` scaffold:**

```bash
cd thirdeye-vest
python -m venv .venv && source .venv/bin/activate
pip install fastapi uvicorn[standard] pydantic-settings bleak
pip freeze > requirements.txt
```

Create `thirdeye/models.py` today with the Pydantic models mirroring §7.2 and §7.4. Create `thirdeye/main.py` as a FastAPI app with `/api/health` returning `{"ok": true}` and nothing else. That is enough to prove the toolchain.

**`thirdeye-cloud` scaffold:** `README.md` and `pyproject.toml` only. Nothing else today.

**`thirdeye-mobile` scaffold:**

```bash
npx create-expo-app@latest thirdeye-mobile --template blank-typescript
cd thirdeye-mobile
npx expo install expo-router expo-sqlite expo-file-system expo-camera \
  react-native-safe-area-context react-native-screens \
  react-native-svg react-native-gesture-handler react-native-reanimated
npm install zustand
npm install --save-dev @types/react eslint prettier
```

**Build a development build, not Expo Go.** You will need native config in Phase 3 and switching later is painful.

```bash
npx expo prebuild
npx expo run:android
```

### 9.2 Shared protocol types

Write these once, in TypeScript, today. The Python side mirrors them.

`src/types/protocol.ts`:

```ts
export const PROTOCOL_VERSION = 1;

export type ClosedBy = 'button' | 'timeout' | 'recovered' | 'manual';

export type ClipStatus =
  | 'announced'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'failed'
  | 'expired';

export interface ClipMeta {
  v: number;
  match_id: string;
  seq: number;
  camera_id: string;
  started_at: number;
  ended_at: number;
  duration_s: number;
  preroll_s: number;
  closed_by: ClosedBy;
  resolution: string;
  fps: number;
  codec: string;
  bytes: number;
  sha256: string;
  over: number | null;
  ball_in_over: number | null;
  legal: boolean;
}

/** Local-only fields the phone tracks on top of ClipMeta. */
export interface Clip extends ClipMeta {
  status: ClipStatus;
  bytesLocal: number;
  localPath: string | null;
  thumbPath: string | null;
  pinned: boolean;
  pinReason: string | null;
  reviewed: boolean;
  attempts: number;
  lastError: string | null;
}

export type ServerMessage =
  | { v: number; type: 'hello'; camera_id: string; match_id: string | null;
      seq_latest: number; protocol: number; firmware: string }
  | { v: number; type: 'clip_ready'; seq: number; bytes: number;
      sha256: string; duration_s: number; closed_by: ClosedBy }
  | { v: number; type: 'clip_expired'; seq: number }
  | { v: number; type: 'session_state'; state: 'idle' | 'recording';
      seq: number; since: number }
  | { v: number; type: 'status'; battery_pct: number; temp_c: number;
      disk_free_gb: number; encoder_fps: number; clips_held: number }
  | { v: number; type: 'pong'; t: number };

export type ClientMessage =
  | { v: number; type: 'ack'; seq: number; sha256: string }
  | { v: number; type: 'pin'; seq: number; pinned: boolean; reason: string }
  | { v: number; type: 'ping'; t: number }
  | { v: number; type: 'resync'; since_seq: number };

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';
```

Commit the same shapes as a JSON fixture in both repos (`fixtures/protocol_v1.json`) and write one test each side that validates against it. Ten minutes now, saves an afternoon in Phase 3.

### 9.3 Theme and design direction

Before writing screens, decide the visual language. This app is used **outdoors, in sunlight, by someone wearing a wide-brimmed hat, under time pressure, with one hand.**

That drives every decision:

| Constraint | Consequence |
|---|---|
| Sunlight | High contrast. Dark text on near-white, or a true dark theme. No mid-greys. |
| One hand, gloves possible | Touch targets minimum 56 dp. Primary actions in the bottom third. |
| Time pressure | No modals. No confirmation dialogs on the review path. |
| Glanceable | Status must be readable at arm's length without focusing. |
| Small numbers matter | Ball numbers and over.ball in large tabular figures. |

`src/theme/colors.ts`:

```ts
export const colors = {
  bg:        '#FFFFFF',
  surface:   '#F4F5F7',
  border:    '#D6D9DE',
  text:      '#111418',
  textMuted: '#5A6270',

  // Status dots. These carry meaning, so they must also differ in shape
  // or label for anyone who cannot distinguish them by hue.
  ready:     '#1B8A4B',
  pending:   '#C77700',
  missing:   '#8A9099',

  accent:    '#1F4FD8',
  danger:    '#C2261C',
  recording: '#C2261C',
} as const;
```

**Never encode meaning in colour alone.** Every status dot gets a text label next to it too: `Ready`, `Getting it`, `Not here`. Red-green colour blindness affects roughly 8% of men, and you are shipping to a cricket league.

`src/theme/typography.ts`: two sizes for body (15, 13), one for numerals (`fontVariant: ['tabular-nums']`, 22), one for screen titles (24, weight 600). That is all you need.

### 9.4 Stores and mock data

**`src/stores/connectionStore.ts`**

```ts
interface ConnectionStore {
  state: ConnectionState;
  cameraId: string | null;
  lastPongAt: number | null;
  battery: number | null;
  tempC: number | null;
  encoderFps: number | null;

  connect: (host: string) => void;
  disconnect: () => void;
  // Phase 1: these are driven by mockServer, not a real socket
}
```

**`src/stores/clipStore.ts`**

```ts
interface ClipStore {
  clips: Clip[];                       // newest first, max 12 + pinned
  byId: (seq: number) => Clip | undefined;

  upsert: (clip: Partial<Clip> & { seq: number }) => void;
  setStatus: (seq: number, status: ClipStatus) => void;
  pin: (seq: number, reason: string) => void;
  markReviewed: (seq: number) => void;
  purgeBeyondRing: () => void;         // drops the 13th unless pinned/reviewed
}
```

**`src/stores/matchStore.ts`**

```ts
interface MatchStore {
  matchId: string | null;
  name: string;
  venue: string;
  startedAt: number | null;
  over: number;
  ballInOver: number;
  deliveryCount: number;

  startMatch: (name: string, venue: string) => void;
  endMatch: () => void;
  incrementBall: (legal: boolean) => void;
}
```

**`src/mock/mockClips.ts`** — make this realistic, not lorem ipsum. Twelve clips with a deliberate spread of states so you can see every UI branch without doing anything:

```ts
export const mockClips: Clip[] = [
  mk(14, { status: 'ready',       closed_by: 'button',    over: 3, ball: 2 }),
  mk(13, { status: 'downloading', closed_by: 'button',    over: 3, ball: 1,
           bytesLocal: 5_734_400 }),
  mk(12, { status: 'ready',       closed_by: 'timeout',   over: 2, ball: 6 }),
  mk(11, { status: 'ready',       closed_by: 'button',    over: 2, ball: 5,
           pinned: true, pinReason: 'wicket' }),
  mk(10, { status: 'ready',       closed_by: 'button',    over: 2, ball: 4 }),
  mk(9,  { status: 'ready',       closed_by: 'button',    over: 2, ball: 3,
           reviewed: true }),
  mk(8,  { status: 'failed',      closed_by: 'button',    over: 2, ball: 2,
           lastError: 'Connection lost', attempts: 3 }),
  mk(7,  { status: 'ready',       closed_by: 'recovered', over: 2, ball: 1 }),
  mk(6,  { status: 'ready',       closed_by: 'button',    over: 1, ball: 6,
           legal: false }),          // a wide
  mk(5,  { status: 'ready',       closed_by: 'button',    over: 1, ball: 5 }),
  mk(4,  { status: 'ready',       closed_by: 'manual',    over: 1, ball: 4 }),
  mk(3,  { status: 'expired',     closed_by: 'button',    over: 1, ball: 3 }),
];
```

Ship a real 15-second MP4 in `assets/mock/sample.mp4` so the player screen actually plays something. Film a friend bowling in a park if you have to. Testing a video player against a black rectangle teaches you nothing.

**`src/mock/mockServer.ts`** — a timer that pushes a new `clip_ready` every 40 seconds, walks a clip through `announced → downloading → verifying → ready` over about 3 seconds, and occasionally fails one. This is what makes the UI feel real. Put it behind a settings toggle so you can also freeze it.

### 9.5 Screen: Pair, and Screen: Match setup

**`app/index.tsx` — Pair**

- Large "Scan the code on the vest" prompt
- `expo-camera` QR scanner filling most of the screen
- Below: a "Enter manually" fallback with an IP field, because QR scanning in bright sun is unreliable and you will need this on day one
- On success: store `{ssid, password, host, cameraId}`, navigate to setup

Phase 1: accept any QR code, or the manual field, and move on. No real network.

**`app/setup.tsx` — Match setup**

- Match name (default: today's date plus venue)
- Venue (free text, remember the last five)
- Which end you are standing (bowler's end / square leg) — this becomes useful in v2 with two units
- Big "Start match" button, bottom third

On start: `matchStore.startMatch()`, navigate to `live`.

### 9.6 Screen: Live — the one that matters

This is where the umpire spends the match. Get this right and the product works.

**Layout, top to bottom:**

```
┌─────────────────────────────────────────┐
│ ● Connected      🔋 62%   🌡 51°   ⚙    │  ← status bar, always visible
├─────────────────────────────────────────┤
│                                         │
│           Over 3, ball 2                │  ← big tabular numerals
│              14 balls                   │  ← total delivery count
│                                         │
│         ⏺  RECORDING                    │  ← only when state=recording
│                                         │
├─────────────────────────────────────────┤
│  ● Ready   Ball 14   3.2      15.3s  📌 │  ← newest first
│  ◐ Getting it  Ball 13  3.1   14.8s     │
│  ● Ready   Ball 12   2.6  ⏱  40.0s      │  ← timeout icon
│  ● Ready   Ball 11   2.5      12.1s  📌 │  ← pinned
│  ● Ready   Ball 10   2.4      13.7s     │
│  ● Ready   Ball 9    2.3      15.3s  ✓  │  ← reviewed
│  ○ Not here  Ball 8  2.2      —          │
│  ● Ready   Ball 7    2.1  ⚠  18.2s      │  ← recovered
│  ...                                     │
├─────────────────────────────────────────┤
│        [ Grab last 20 seconds ]         │  ← emergency recovery
└─────────────────────────────────────────┘
```

**Component checklist:**

| Component | Behaviour |
|---|---|
| `ConnectionPill` | Green "Connected", amber "Reconnecting…", grey "Offline". Tappable, opens a small diagnostic sheet. |
| `BallCounter` | Over.ball in 32pt tabular figures. Tap to correct if it drifts. Long-press to reset the over. |
| `RecordingIndicator` | Only rendered when `session_state === 'recording'`. Red dot, gentle pulse, plus the word RECORDING. Never rely on the dot alone. |
| `ClipRow` | 64 dp tall minimum. Status dot + label, ball number, over.ball, duration, and icon badges for pinned / reviewed / timeout / recovered. Whole row is the tap target. |
| `StatusDot` | 12 dp circle + text label. Shape differs per state too: filled for ready, half-filled for pending, hollow for missing. |
| `PinButton` | Swipe-right on a row to pin, or a long-press menu. No modal. |
| `GrabButton` | Full-width, bottom. Calls `/api/clips/recover`. Confirms inline, not with a dialog. |

**Interaction rules, non-negotiable:**

1. **No modal ever appears on this screen.** If an umpire has to dismiss a dialog while a captain is arguing with them, you have failed.
2. **The list never reorders under the user's finger.** New clips push in at the top with a brief highlight, they do not resort.
3. **Tapping a row navigates instantly.** Any loading happens on the next screen, not as a spinner on this one.
4. **The screen stays awake.** `expo-keep-awake` while a match is active.
5. **Pull-to-refresh forces a resync.** Umpires will do this reflexively when they are unsure. Make it do something useful.

**Phase 1 acceptance:** with `mockServer` running, the list fills up over a few minutes, statuses transition on their own, the 13th clip pushes the 1st off unless pinned, and every badge state is visible somewhere in the list.

### 9.7 Screen: Review player

The other screen that matters. This is where the 90 seconds go.

**Layout:**

```
┌─────────────────────────────────────────┐
│ ←  Ball 9 · Over 2.3            📌  ✓   │
├─────────────────────────────────────────┤
│                                         │
│                                         │
│           [ VIDEO, 16:10 ]              │  ← tap to play/pause
│                                         │
│                                         │
├─────────────────────────────────────────┤
│ ├──────────●───────────────────────┤    │  ← scrubber, frame-precise
│ 0:00                          0:15      │
├─────────────────────────────────────────┤
│    ⏮   ◀◀    ▶    ▶▶   ⏭                │  ← frame back / play / frame fwd
├─────────────────────────────────────────┤
│  1×   ½×   ¼×   ⅛×                      │  ← speed, big buttons
├─────────────────────────────────────────┤
│  [ Stump line ]  [ Bail height ]        │  ← overlay toggles
├─────────────────────────────────────────┤
│  Mark decision:  Out   Not out   Unclear│
└─────────────────────────────────────────┘
```

**The hard part is frame stepping.** Budget real time here. On Android with `react-native-video`:

- Seeking to an exact frame requires the player to be paused and to seek with exact (not nearest-keyframe) semantics
- Frame duration is `1 / fps`. At 60 fps that is 16.67 ms
- Step forward: `seek(currentTime + 1/fps)`, step back: `seek(currentTime - 1/fps)`
- ExoPlayer's default seek is to the nearest sync frame. You need `SEEK_PARAMETER_EXACT` behaviour, which `react-native-video` exposes via the `seek` config on Android

If `react-native-video` cannot give you exact seeks, the fallback is a small native module wrapping `MediaCodec` decode-to-surface. **Do not discover this on match day.** Test it in Phase 1 with your sample MP4.

**Overlays** (`OverlayCanvas.tsx`, `react-native-svg`):

- A draggable vertical line the umpire aligns with the stumps
- A draggable horizontal line for bail height
- Both persist per clip, not globally
- Both must be draggable with one thumb

**Decision capture:** three big buttons writing to the `reviews` table. This is not a formality. The decision log is what a league will want to see after the season, and it is the artefact that justifies the whole system existing.

**Phase 1 acceptance:** loads `assets/mock/sample.mp4`, plays, scrubs, steps single frames in both directions, switches speed, and both overlay lines drag smoothly. Decision buttons write to SQLite and the badge appears back on the live screen.

### 9.8 Screens: Summary and Settings

**`app/summary.tsx`** — shown after "End match":

- Deliveries recorded, clips delivered, clips missed
- Reviews called, with outcomes
- Pinned clips as a scrollable strip
- "Purge everything unpinned" as the primary action
- "Sync when I'm on Wi-Fi" toggle (does nothing in Phase 1)

**`app/settings.tsx`:**

- Pre-roll seconds (default 3)
- Timeout seconds (default 40)
- Ring size (default 12)
- Keep pinned clips for N days (default 7)
- Mock server on/off, and mock speed — **keep this in the build until Phase 7**
- Diagnostics: raw WebSocket message log, tail 200. You will live in this screen during Phase 3.

### 9.9 End-of-day checklist

Tick every box before you stop.

- [ ] Four repos exist, each with a README and a first commit pushed
- [ ] `thirdeye-remote` builds with `pio run` (even though it does nothing)
- [ ] `thirdeye-vest` serves `/api/health` on localhost
- [ ] `thirdeye-mobile` runs as a dev build on a **real Android phone**, not just an emulator
- [ ] Protocol types exist in TS and Python, with the shared JSON fixture and a passing test each side
- [ ] SQLite schema created and migrated on first launch
- [ ] All six screens navigable
- [ ] The live screen fills with mock clips over time, statuses transition, and the ring rolls over
- [ ] Every status dot state is visible in the mock data
- [ ] The player plays the sample MP4 and steps single frames
- [ ] You have walked a non-technical person through the flow and they understood it

That last one is the real acceptance test.

### 9.10 What to deliberately not do today

| Temptation | Why not |
|---|---|
| Real WebSocket code | You have no server. Mock it, do it properly in Phase 3. |
| Real download logic | Same. The download queue is Phase 3. |
| Flashing the ESP32 | Phase 5. You do not need it to know if the UI works. |
| Setting up hostapd | Phase 2. It will eat your entire afternoon. |
| Polishing animations | The umpire will never notice. The status dots, they will notice. |
| Building for iOS | Phase 2 of the *product*, not of the build. Android first. |

---

## 10. Phase 2 to 8

### Phase 2: Vest brings up

**Goal: the ROCK boots, creates its own Wi-Fi network, and records hardware-encoded video from the AR0234 to the SSD.**

**2.1 OS and base setup**

Flash the **Radxa-provided Debian image**, not vanilla Debian. You need the Rockchip BSP kernel for the VPU drivers. Mainline does not have working H.265 encode on RK3588S2 yet.

```bash
# Verify you have the hardware encoder
ls /dev/video*        # look for /dev/video-enc0 or similar
v4l2-ctl --list-devices
gst-inspect-1.0 | grep -iE "mpp|rkmpp|v4l2h26"
```

**This is the single most important verification in the whole project.** If neither `mpph265enc` nor `v4l2h265enc` exists, you are software-encoding on a CPU that cannot do 1080p60, and the whole timing budget collapses. Find this out on day one of Phase 2, not on day three.

Mount the NVMe at `/data` with `noatime`. Create `/dev/shm/preroll` as tmpfs (it already is, `/dev/shm` is tmpfs by default) with a size limit:

```bash
# /etc/fstab
tmpfs /dev/shm tmpfs defaults,size=512M 0 0
```

512 MB holds about 40 seconds of 5 Mbps segments with room to spare.

**2.2 Wi-Fi access point**

```bash
sudo apt install hostapd dnsmasq
sudo systemctl unmask hostapd
```

Tell NetworkManager to leave the AP interface alone, or the two will fight over it every boot:

```ini
# /etc/NetworkManager/conf.d/99-thirdeye.conf
[keyfile]
unmanaged-devices=interface-name:wlan0
```

`deploy/hostapd.conf`:

```ini
interface=wlan0
driver=nl80211
ssid=ThirdEye-01
hw_mode=a                 # 'a' = 5 GHz. 'g' = 2.4 GHz.
channel=36
country_code=US
ieee80211n=1
ieee80211ac=1
wmm_enabled=1
ht_capab=[HT40+][SHORT-GI-20][SHORT-GI-40]
vht_oper_chwidth=1
vht_oper_centr_freq_seg0_idx=42
auth_algs=1
wpa=2
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
wpa_passphrase=CHANGE_ME_PER_UNIT
```

⚠️ **Verify your Wi-Fi chip supports 5 GHz AP mode before relying on this.** Many cheap modules do 5 GHz client but 2.4 GHz-only AP. Check with `iw list | grep -A 20 "Supported interface modes"` and look for `AP` under the 5 GHz band.

`deploy/dnsmasq.conf`:

```ini
interface=wlan0
bind-interfaces
dhcp-range=192.168.43.10,192.168.43.50,255.255.255.0,12h
dhcp-option=3          # no default gateway: no internet, on purpose
dhcp-option=6          # no DNS server
address=/thirdeye.local/192.168.43.1
```

Setting `dhcp-option=3` and `6` to empty is deliberate. It tells the phone this network has no internet, which stops Android from complaining and from trying to route traffic here.

Static IP on the AP interface:

```ini
# /etc/systemd/network/10-wlan0.network
[Match]
Name=wlan0
[Network]
Address=192.168.43.1/24
```

**2.3 Camera and encoding**

```bash
v4l2-ctl -d /dev/video0 --list-formats-ext   # what does the AR0234 actually offer?
```

Record the answer in the README. Then benchmark both encoder paths with `scripts/bench_encoder.py`, measuring sustained fps over 10 minutes, not 10 seconds. Thermal throttling shows up at minute six, not minute one.

A working pipeline, once you know which encoder element exists:

```bash
gst-launch-1.0 -e \
  v4l2src device=/dev/video0 io-mode=4 ! \
  video/x-raw,format=UYVY,width=1920,height=1200,framerate=60/1 ! \
  videoconvert ! \
  mpph265enc bps=5000000 gop=60 ! \
  h265parse ! \
  splitmuxsink location=/dev/shm/preroll/seg_%05d.mp4 \
    max-size-time=1000000000 \
    muxer-factory=mp4mux \
    muxer-properties="properties,fragment-duration=1000"
```

Key points:

- `gop=60` at 60 fps means a keyframe every second, which is what makes 1-second segments possible and stream-copy concatenation lossless
- `max-size-time=1000000000` is 1 second in nanoseconds
- `fragment-duration` makes each segment a **fragmented** MP4, so it is valid the instant it is closed
- Second branch via a `tee` writes the 15 Mbps archive copy to `/data`

**2.4 Acceptance**

- [ ] `hostapd` starts on boot, a phone can join `ThirdEye-01` and get an IP
- [ ] `iw dev wlan0 info` shows 5 GHz, and the phone reports 5 GHz
- [ ] Camera records for 30 minutes with no dropped frames and no thermal throttle
- [ ] Segments appear in `/dev/shm/preroll` at 1/second and are each individually playable
- [ ] Measured sustained encoder fps is within 1% of target
- [ ] `iperf3` between phone and ROCK shows **at least 25 Mbps** with a human body between them

That last one is the number the whole architecture rests on. Measure it outdoors, at a ground, with the unit actually on a chest. Not on your desk.

---

### Phase 3: The link

**Goal: the phone talks to the real vest, holds a WebSocket open for an hour, and downloads a real file.**

**3.1 FastAPI + nginx**

Stand up the routes from §7.3. Serve `/clips/` from nginx, not FastAPI. Proxy `/api` and `/ws` to uvicorn on `127.0.0.1:8000`.

`deploy/systemd/thirdeye-api.service`:

```ini
[Unit]
Description=Third Eye API
After=network.target

[Service]
Type=simple
User=thirdeye
WorkingDirectory=/opt/thirdeye
ExecStart=/opt/thirdeye/.venv/bin/uvicorn thirdeye.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=2
WatchdogSec=30

[Install]
WantedBy=multi-user.target
```

**3.2 The Android networking gotchas**

This is where Phase 3 will actually go wrong, so plan for it.

**Cleartext HTTP.** Android blocks it by default. Add `android/app/src/main/res/xml/network_security_config.xml`:

```xml
<network-security-config>
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">192.168.43.1</domain>
  </domain-config>
</network-security-config>
```

and reference it from `AndroidManifest.xml` with `android:networkSecurityConfig`.

**Binding to the Wi-Fi network.** When a phone joins a Wi-Fi network with no internet, Android may keep routing app traffic over cellular. You must explicitly bind your sockets to the Wi-Fi network:

```kotlin
val request = NetworkRequest.Builder()
    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
    .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    .build()
connectivityManager.requestNetwork(request, callback)
// then bind: network.bindSocket(socket) or ConnectivityManager.bindProcessToNetwork(network)
```

`removeCapability(NET_CAPABILITY_INTERNET)` is the line people miss. Without it Android will not offer you a network that has no internet.

**Foreground service.** The WebSocket must survive the screen turning off between overs. That needs a foreground service with a persistent notification. There is no way around this on modern Android and there should not be.

**3.3 The download queue**

`src/net/downloadQueue.ts`:

- One at a time, oldest first. **Never parallel.** Two concurrent transfers on one Wi-Fi link do not finish faster, they make both slower and make failures harder to reason about.
- Exponential backoff: 1 s, 2 s, 4 s, 8 s, capped at 10 s
- Resume via `Range: bytes={bytesLocal}-`, reading `bytesLocal` from `stat` on the `.part` file, not from memory
- Hard deadline: if a clip is still unfetched when it falls out of the 12-ball ring, mark it `expired` permanently and stop. Otherwise the queue grows forever chasing a clip nobody will watch.
- Verify size, then SHA-256, then rename `.part` to `.mp4`, then send `ack`. In that order, always.

**3.4 Acceptance**

- [ ] WebSocket stays connected for 60 minutes with the screen off
- [ ] Killing Wi-Fi for 2 minutes and restoring it triggers `resync` and backfills every missed clip
- [ ] A download interrupted at 60% resumes rather than restarting (verify with a network log, not by feel)
- [ ] A deliberately corrupted file fails hash verification and is retried, not shown
- [ ] `ack` is never sent before the rename

---

### Phase 4: Clipping and pre-roll

**Goal: a simulated button press produces a correctly-bounded clip including 3 seconds of pre-roll.**

**4.1 The ring buffer janitor**

`thirdeye/capture/preroll.py`: a loop that deletes any segment in `/dev/shm/preroll` older than 20 seconds. Runs every second. That is the whole thing.

**4.2 The cutter**

`thirdeye/capture/cutter.py`, on clip close:

1. Compute the window: `[start_ts - preroll_s, end_ts]`
2. Select every segment whose time range overlaps that window
3. Write an ffmpeg concat list
4. `ffmpeg -f concat -safe 0 -i list.txt -c copy -movflags +faststart out.mp4`
5. `stat` for size, `hashlib.sha256` streaming for the fingerprint
6. Write the metadata JSON
7. Emit `clip_ready` on the WebSocket

Because segments are keyframe-aligned and fragmented, step 4 is a stream copy with no re-encode. It should take well under 500 ms for a 15-second clip. **Measure it.** If it takes 5 seconds, something is re-encoding and you need to find out what.

**4.3 Boundary precision**

Segments are 1 second, so clip boundaries land on 1-second granularity. That is fine because the window is generous on both sides. Do not try to trim finer with `-ss` on a stream copy, it can only cut at keyframes anyway.

**4.4 Acceptance**

- [ ] Simulated START at T, END at T+12 produces a clip covering T-3 to T+12
- [ ] Cut time is under 500 ms for a 15-second clip
- [ ] The output MP4 is playable in VLC, in the phone app, and in a browser
- [ ] SHA-256 computed on the vest matches the one computed on the phone
- [ ] The 40-second timeout fires and flags `closed_by: timeout`
- [ ] A "recovered" cut (END with no START) produces a valid 20-second clip

---

### Phase 5: The remote

**Goal: real hardware, real buttons, and both recovery paths in the state machine.**

**5.1 Firmware**

- NimBLE GATT server, service and characteristic UUIDs from §7.5
- Two GPIO inputs with internal pull-ups, hardware debounce in software (2 s minimum between accepted events)
- Notify on every event with an incrementing counter
- Heartbeat every 10 s
- Battery via ADC on the LiPo divider
- Deep sleep between presses with GPIO wake, target 40+ hours of standby

**5.2 The listener**

`thirdeye/remote/ble_listener.py` using `bleak`:

- Scan for the service UUID, connect, subscribe to notifications
- Auto-reconnect on disconnect with backoff
- Detect counter gaps and log them
- Feed events into `state_machine.py`

**5.3 The state machine**

Implement §7.6 exactly, **including both bold rows**. Write unit tests for all six transitions before you touch hardware. These are the paths that will save a match and they are trivially testable without any device.

**5.4 Feedback to the umpire**

An LED on the vest, angled so the wearer can see it by glancing down at their chest:

| Pattern | Meaning |
|---|---|
| Slow green pulse | Idle, healthy, phone connected |
| Solid red | Recording |
| Fast amber blink | Phone disconnected |
| Double red flash | Remote battery low |

This is one dollar of hardware and it is the only feedback the umpire gets without looking at the phone. Do not skip it.

**5.5 Acceptance**

- [ ] All six state transitions verified with real button presses
- [ ] Missed END press: next START closes the old clip and opens a new one
- [ ] Missed START press: END recovers from the ring, flagged `recovered`
- [ ] Two presses within 2 s register as one
- [ ] Remote survives 4 hours of realistic use on one charge
- [ ] BLE reconnects within 10 s of walking out of range and back

---

### Phase 6: Hardening

**Goal: it survives things going wrong without anyone noticing.**

- **Retention on both sides.** Vest holds until `ack`. Phone drops the 13th unless pinned or reviewed. Neither side deletes unilaterally.
- **Health monitoring.** Battery, SoC temperature, disk free, and **actual measured encoder fps**. That last one catches silent degradation, which is the failure mode that will bite you: a pipeline that quietly drops from 60 fps to 12 without erroring.
- **Watchdogs.** Every systemd unit with `Restart=always` and `WatchdogSec`. A capture pipeline that dies must restart within 5 seconds.
- **Disk pressure.** Warn at 85%, drop archive copies at 92%, stop recording at 97%. Never let the SSD fill silently.
- **Thermal.** Log SoC temperature every 10 s to the health endpoint. If it crosses 80 °C, drop the archive stream first.
- **Clock sync.** The ROCK has no RTC by default and no internet. Have the phone push its time on WebSocket connect, and use that as the session clock. Otherwise clip timestamps will be nonsense.
- **Crash recovery.** On boot, scan `/data/matches/current` and rebuild the ring from what is on disk. Do not assume state was held in memory.

**Chaos tests, run all of them:**

| Test | Expected |
|---|---|
| Pull the camera USB mid-match | Pipeline restarts within 5 s, one clip lost, health flags it |
| Kill `hostapd` | Phone goes amber, clips queue, all backfill on restore |
| Fill the disk to 99% | Archive copies dropped, review copies keep recording |
| Force-quit the phone app | On relaunch, `.part` files resume, `resync` catches up |
| Reboot the ROCK mid-over | Session recovered from disk, ring rebuilt |
| Remote battery to zero | Vest keeps recording, warns, fallback record button works in the app |

---

### Phase 7: Field trial

**Goal: two overs at a real fixture, with numbers.**

Do not go straight to a full match. Two overs, then stop and look at the data.

**Measure:**

| Metric | Target |
|---|---|
| Clips delivered / deliveries bowled | > 98% |
| Median time from END press to `status: ready` | < 5 s |
| p95 time from END press to `status: ready` | < 12 s |
| Sustained Wi-Fi throughput | > 25 Mbps |
| Encoder fps drift over 3 hours | < 2% |
| Missed button presses | < 2% |
| Battery remaining after 3 hours | > 25% |

**Also record, subjectively:**

- Was the impact zone actually in frame? **Count it, over by over.** This is the assumption everything rests on and nobody has verified it.
- Did the umpire look at the LED? Did they trust it?
- How long did the harness take to become uncomfortable?
- What did the players say when they noticed?

**Before this happens:** take a two-page proposal to the NWCL committee covering who may call a review, how many per innings, within what time window, and who has final say. Without playing-condition backing you have built an argument machine rather than a resolution machine.

---

### Phase 8: Cloud

**Goal: pinned clips and the review log reach a server, eventually.**

Everything here is deferred and optional. Nothing on match day may depend on it.

- `POST /api/matches` — create a match record
- `POST /api/clips` — presigned upload to Supabase Storage, then register metadata
- `POST /api/reviews` — the decision log
- Postgres schema mirroring §7.7 minus the local-only fields
- Retention policy: pinned clips expire after N days unless a league admin marks them retained

**Decide the retention policy before anyone asks for footage.** A wicket clip could be subpoenaed into a disciplinary hearing. Know what you will say.

---

## 11. Risks and open questions

### Must be answered before Phase 2

| # | Question | Why it blocks | Owner |
|---|---|---|---|
| 1 | Does the ROCK 5C's Wi-Fi module support **5 GHz AP mode**? | If not, you are on crowded 2.4 GHz and the throughput budget is at risk | |
| 2 | Which GStreamer encoder element exists on the Radxa image, `mpph265enc` or `v4l2h265enc`? | If neither, hardware encoding is unavailable and the whole timing budget collapses | |
| 3 | What formats and framerates does your specific AR0234 module offer over UVC? | Decides UYVY-at-60 vs MJPEG-at-120, and whether a decode step is needed | |
| 4 | Whose phone? Umpire's own, or league-owned? | Changes the BOM by $80 and the consent conversation entirely | |
| 5 | HTTP, self-signed HTTPS, or HTTP + HMAC? | Changes the Android manifest and the pairing payload | |

### Top risks, ranked

**1. The camera will not be pointing where you need it.**

An umpire's *eyes* track the ball. Their chest does not. At the moment of impact the bowler's-end umpire is often leaning, stepping aside, or already turning for a run-out. You cannot fix this in software: if the pads left frame, they left frame.

*Mitigation:* before building anything else, strap a phone to your chest and umpire two overs. Watch the footage. If the impact zone is in frame 90% of the time, proceed. If it is 60%, this form factor does not work and you need a stump-mounted or tripod camera instead. **This is a one-afternoon test that either validates or kills the core assumption.** Do it this week.

**2. Silent thermal degradation.**

A pipeline that quietly drops from 60 fps to 12 without erroring is the worst failure mode, because you only find out when the footage looks wrong. *Mitigation:* measure actual encoded fps continuously and surface it in health. Alert on any drop over 5%.

**3. Missed button presses cluster around the balls that matter.**

480 presses per innings at 99% reliability is 5 misses. They will not be random. They will cluster around the deliveries where something dramatic happened, because that is when the umpire's attention is elsewhere. Which is exactly when a review gets called.

*Mitigation:* the pre-roll ring and both recovery transitions. Log every press and every recovery. After three matches you will know your real miss rate. If it exceeds 2%, revisit gated recording and go continuous.

**4. Every failure is a high-visibility failure.**

The system is only ever used in the moments people care most about. A 98% reliable system *feels* broken, because nobody notices the 98% and everyone remembers the two times the umpire stood there tapping a phone while 22 players watched.

*Mitigation:* the status dot. If the umpire can see a clip exists before announcing a review, a failure becomes "let's not review this one" instead of a public failure.

**5. The league has not said you are allowed to do this.**

*Mitigation:* two-page proposal to the committee before you order hardware. Costs nothing, de-risks everything.

### Secondary risks

| Risk | Mitigation |
|---|---|
| Umpires swap ends every over | This is actually a feature: your 12-ball window contains one over from behind the bowler and one from square leg. Label which is which. |
| Frame-accurate seeking is hard | Test with the sample MP4 in Phase 1, not on match day. Fallback is a `MediaCodec` native module. |
| Lens fog and rain in the Pacific Northwest | Anti-fog insert, rain sleeve, and test it wet before you trust it |
| Players objecting to being filmed | The auto-purge is your answer. Lead with it, do not defend it. |
| Pinned clips become disciplinary evidence | Decide the retention policy in Phase 8 *before* someone asks |
| Harness comfort over three hours | Test on a real umpire, not on yourself for ten minutes |
| iOS local network permissions | Android first. iOS needs `NEHotspotConfiguration`, `NSLocalNetworkUsageDescription`, and an ATS exception. Budget a week for it, in v2. |

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Clip** | One delivery, as a video file. Identified by `(match_id, seq)`. |
| **Delivery / `seq`** | A ball bowled, legal or not. Wides and no-balls each get their own `seq`. |
| **Pre-roll** | The 3 seconds before the START press, pulled from the ring buffer, so a late press still catches the run-up. |
| **Ring buffer** | 20 seconds of 1-second video segments held in tmpfs. Continuously overwritten. |
| **The ring** | The 12 most recent clips held on the phone and the vest. Distinct from the ring buffer. |
| **Pinned** | A clip exempted from auto-purge. Wickets, reviews, anything the umpire marked. |
| **`.part`** | A partially downloaded file. Renamed to `.mp4` only after size and hash both verify. |
| **fMP4** | Fragmented MP4. Index written up front, so the file is valid the instant recording stops. |
| **Control channel** | The always-open WebSocket. Text only, ~80 bytes per message. |
| **File channel** | Per-clip HTTP GET with byte-range support. 9.5 MB per delivery. |
| **`closed_by`** | How a clip ended: `button`, `timeout`, `recovered`, or `manual`. |
| **Recovered clip** | A clip cut from the ring buffer because the START press was missed. |
| **NWCL** | Northwest Cricket League, the target league. |
| **UVC** | USB Video Class. Standard protocol, means no custom camera driver. |
| **VPU / MPP** | Rockchip's hardware video encoder and its userspace API. |

---

## 13. Appendix: command cheat sheet

### Vest

```bash
# Services
sudo systemctl status thirdeye-api thirdeye-capture thirdeye-ble
sudo journalctl -u thirdeye-capture -f

# Camera
v4l2-ctl --list-devices
v4l2-ctl -d /dev/video0 --list-formats-ext
v4l2-ctl -d /dev/video0 --all

# Encoder discovery (run this first, Phase 2)
gst-inspect-1.0 | grep -iE "mpp|rkmpp|v4l2h26"

# Wi-Fi AP
sudo systemctl status hostapd dnsmasq
iw dev wlan0 info
iw list | grep -A 20 "Supported interface modes"
sudo journalctl -u hostapd -f

# Who is connected
iw dev wlan0 station dump
cat /var/lib/misc/dnsmasq.leases

# Throughput test (the number everything depends on)
iperf3 -s                       # on the ROCK
iperf3 -c 192.168.43.1 -t 30    # on a laptop joined to the AP

# BLE
bluetoothctl scan on
sudo btmon                      # raw HCI trace when bleak misbehaves

# Health
cat /sys/class/thermal/thermal_zone*/temp
df -h /data
ls -la /dev/shm/preroll | head
```

### Mobile

```bash
npx expo run:android              # dev build
npx expo start --dev-client       # attach to an installed dev build
adb logcat | grep -i thirdeye
adb shell run-as com.thirdeye.app ls files/matches   # inspect app-private storage

# Verify a downloaded clip matches the vest
adb pull /sdcard/Download/clip_0009.mp4 .
shasum -a 256 clip_0009.mp4
```

### Remote

```bash
pio run                           # build
pio run -t upload                 # flash
pio device monitor                # serial log
```

### Quick sanity checks

```bash
# Does the API answer?
curl -s http://192.168.43.1/api/health | jq

# Does nginx serve ranges?
curl -sI -H "Range: bytes=0-1023" http://192.168.43.1/clips/9.mp4
# Expect: HTTP/1.1 206 Partial Content

# Watch the WebSocket
websocat ws://192.168.43.1/ws

# Time a clip cut
time ffmpeg -f concat -safe 0 -i list.txt -c copy -movflags +faststart out.mp4
```

---

## Document history

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-09-06 | First draft. Stack chosen, phases defined, Phase 1 scoped. |

**Next revision should add:** answers to the five blocking questions in §11, the result of the chest-camera framing test, and the measured `iperf3` number from a real ground.
