import json
from urllib.parse import urlparse

import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient

from brain.main import app, brain


def make_http_pair(evt_id: int, url: str, method: str = "GET", status: int = 200, headers=None, res_headers=None, body_size: int = 100, ttfb: float = 120.0, cookie: str | None = None, auth: str | None = None):
    req_headers = headers or {}
    if cookie:
        req_headers["cookie"] = cookie
    if auth:
        req_headers["authorization"] = auth
    request = {
        "id": f"evt_{evt_id}r",
        "plane": "A",
        "type": "http",
        "phase": "request",
        "tabId": 1,
        "frameId": "frame1",
        "ts": evt_id * 1.0,
        "corr": {"cdpRequestId": str(evt_id)},
        "http": {
            "method": method,
            "url": {"raw": url, "host": urlparse(url).netloc, "path": urlparse(url).path},
            "headers": {"req": req_headers},
            "body": {"kind": "none", "size": 0},
        },
    }
    response = {
        "id": f"evt_{evt_id}p",
        "plane": "A",
        "type": "http",
        "phase": "response",
        "tabId": 1,
        "frameId": "frame1",
        "ts": evt_id * 1.0 + 0.5,
        "corr": {"cdpRequestId": str(evt_id)},
        "http": {
            "method": method,
            "url": {"raw": url, "host": urlparse(url).netloc, "path": urlparse(url).path},
            "status": status,
            "headers": {"req": {}, "res": res_headers or {}},
            "body": {"kind": "json", "size": body_size},
            "timing": {"ttfb": ttfb},
            "cache": {"fromCache": False, "control": res_headers.get("Cache-Control") if res_headers else None},
        },
    }
    return request, response


def make_ws_events():
    open_evt = {
        "id": "evt_ws_open",
        "plane": "A",
        "type": "ws",
        "phase": "ws_open",
        "tabId": 1,
        "frameId": "frame1",
        "ts": 100.0,
        "corr": {"cdpRequestId": "ws1"},
        "ws": {"url": "wss://example.com/socket"},
    }
    frame_evt = {
        "id": "evt_ws_frame",
        "plane": "A",
        "type": "ws",
        "phase": "ws_frame",
        "tabId": 1,
        "frameId": "frame1",
        "ts": 100.5,
        "corr": {"cdpRequestId": "ws1"},
        "ws": {"url": "wss://example.com/socket", "direction": "recv", "opcode": 1, "size": 20, "preview": "hi"},
    }
    return open_evt, frame_evt


def sample_events():
    events = []
    # Users numeric IDs
    for i in [1, 2]:
        req, res = make_http_pair(i, f"https://example.com/api/users/{i}", cookie="session=abc")
        events.extend([req, res])
    # Posts slugs
    for slug in ["abc123", "def456"]:
        req, res = make_http_pair(10 + len(events), f"https://example.com/api/posts/{slug}")
        events.extend([req, res])
    # Item uuid
    uuid = "550e8400-e29b-41d4-a716-446655440000"
    req, res = make_http_pair(30, f"https://example.com/api/items/{uuid}")
    events.extend([req, res])
    # Login with bearer auth
    req, res = make_http_pair(40, "https://example.com/api/login", method="POST", auth="Bearer abc")
    events.extend([req, res])
    # Third-party GA
    req, res = make_http_pair(50, "https://www.google-analytics.com/collect")
    events.extend([req, res])
    # Websocket
    events.extend(make_ws_events())
    return "\n".join(json.dumps(e) for e in events)


def test_ingest_and_build_profile(tmp_path):
    brain.events.clear()
    brain.profile = None
    brain.summary = None
    brain.output_dir = tmp_path
    client = TestClient(app)
    data = sample_events()
    resp = client.post("/ingest", data=data, headers={"Content-Type": "text/plain"})
    assert resp.status_code == 200
    assert resp.json()["accepted"] > 0
    resp = client.post("/build_profile")
    assert resp.status_code == 200
    profile = resp.json()
    assert profile["auth"]["mode"] in {"cookie", "bearer", "mixed"}
    assert len(profile["endpoints"]) >= 5
    resp = client.get("/profile")
    assert resp.status_code == 200
    resp = client.get("/summary")
    assert resp.status_code == 200
