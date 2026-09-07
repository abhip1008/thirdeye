"""Serving clips, with ranges.

The phone downloads each clip with a plain HTTP GET and resumes with a `Range`
header when a transfer is interrupted. Resume is not a nicety here: the transfer
has to fit in the gap between deliveries, and starting a nine-megabyte file
again from zero because someone walked behind a sightscreen would not.

On the vest nginx does this. This exists so the same behaviour is available when
running the service on its own, and so the phone's resume path can be tested
without standing up a web server.
"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

RANGE = re.compile(r"bytes=(\d*)-(\d*)")
CHUNK = 1 << 18


def serve(path: Path, range_header: str | None) -> Response:
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no such clip")

    size = path.stat().st_size
    headers = {
        "Accept-Ranges": "bytes",
        # The ring deletes these; a cached copy would outlive the promise.
        "Cache-Control": "no-store",
    }

    if not range_header:
        return FileResponse(path, media_type="video/mp4", headers=headers)

    match = RANGE.match(range_header.strip())
    if not match:
        raise HTTPException(status_code=400, detail="malformed range")

    start_text, end_text = match.groups()
    if start_text:
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
    else:
        # A suffix range: the last N bytes.
        start = max(0, size - int(end_text or 0))
        end = size - 1

    if start >= size or end < start:
        return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
    end = min(end, size - 1)

    handle = path.open("rb")
    handle.seek(start)
    remaining = end - start + 1

    def stream():
        left = remaining
        while left > 0:
            block = handle.read(min(CHUNK, left))
            if not block:
                break
            left -= len(block)
            yield block

    # StreamingResponse, not Response: a plain Response tries to encode the body
    # up front, which for a generator fails outright - and it would defeat the
    # point anyway, which is to serve a partial file without reading all of it.
    return StreamingResponse(
        stream(),
        status_code=206,
        media_type="video/mp4",
        headers={
            **headers,
            "Content-Range": f"bytes {start}-{end}/{size}",
            "Content-Length": str(remaining),
        },
        background=BackgroundTask(handle.close),
    )
