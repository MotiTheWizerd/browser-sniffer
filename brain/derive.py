from __future__ import annotations

import re
import statistics
from collections import defaultdict
from typing import Dict, List
from urllib.parse import parse_qs, urlparse

from .models import CanonicalEvent
from .utils import KNOWN_PROVIDERS, template_path


def fuse_http_events(events: List[CanonicalEvent]) -> List[Dict]:
    requests: Dict[str, CanonicalEvent] = {}
    responses: Dict[str, CanonicalEvent] = {}
    for evt in events:
        if evt.type != "http":
            continue
        req_id = evt.corr.get("cdpRequestId")
        if not req_id:
            continue
        if evt.phase == "request":
            requests[req_id] = evt
        elif evt.phase == "response":
            responses[req_id] = evt
    fused: List[Dict] = []
    for req_id, req_evt in requests.items():
        res_evt = responses.get(req_id)
        fused.append({"request": req_evt, "response": res_evt})
    return fused


def derive_site(records: List[Dict]) -> Dict:
    if not records:
        origin = "unknown"
    else:
        first = records[0]["request"].http
        origin = f"{first.url.get('raw') or first.url.get('host') or ''}"
    from datetime import datetime

    ts = datetime.utcnow().isoformat()
    return {"origin": origin, "capturedAt": ts}


def derive_services(records: List[Dict]) -> List[Dict]:
    counts: Dict[str, int] = defaultdict(int)
    for rec in records:
        host = rec["request"].http.url.get("host") or urlparse(
            rec["request"].http.url.get("raw", "")
        ).netloc
        counts[host] += 1
    services = [
        {"host": host, "requestCount": count}
        for host, count in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    ]
    return services


def derive_auth(records: List[Dict]) -> Dict:
    mode = "unknown"
    cookies: List[str] = []
    found_cookie = False
    found_bearer = False
    evidence_cookie = None
    evidence_bearer = None
    for rec in records:
        headers = rec["request"].http.headers.get("req", {})
        auth = headers.get("authorization") or headers.get("Authorization")
        if auth and auth.lower().startswith("bearer "):
            found_bearer = True
            evidence_bearer = rec["request"].id
        cookie_header = headers.get("cookie") or headers.get("Cookie")
        if cookie_header:
            found_cookie = True
            evidence_cookie = evidence_cookie or rec["request"].id
            for part in cookie_header.split(";"):
                name = part.split("=", 1)[0].strip()
                cookies.append(name)
    if found_cookie and found_bearer:
        mode = "mixed"
    elif found_bearer:
        mode = "bearer"
    elif found_cookie:
        mode = "cookie"
    auth_info = {"mode": mode, "cookies": sorted(set(cookies))}
    evidence = [eid for eid in [evidence_cookie, evidence_bearer] if eid]
    if evidence:
        auth_info["evidenceIds"] = evidence
    return auth_info


def derive_endpoints(records: List[Dict]) -> List[Dict]:
    clusters: Dict[str, Dict] = {}
    for rec in records:
        req = rec["request"].http
        url = req.url.get("raw") or req.url.get("path") or ""
        parsed = urlparse(
            url if url.startswith("http") else f"https://{req.url.get('host', '')}{req.url.get('path', '') or ''}"
        )
        path_tmpl = template_path(parsed.path)
        key = f"{parsed.netloc}{path_tmpl}{req.method.upper()}"
        cluster = clusters.setdefault(
            key,
            {
                "key": key,
                "host": parsed.netloc,
                "pathTemplate": path_tmpl,
                "methods": set(),
                "params": {"query": set(), "path": []},
                "errors": defaultdict(int),
                "cache": {"cacheable": False},
                "evidenceIds": [],
            },
        )
        cluster["methods"].add(req.method.upper())
        # Query params
        query_params = parse_qs(parsed.query)
        cluster["params"]["query"].update(query_params.keys())
        # Status errors
        res = rec.get("response")
        if res and res.http.status and res.http.status >= 400:
            cluster["errors"][res.http.status] += 1
            cluster["evidenceIds"].append(res.id)
        elif res:
            cluster["evidenceIds"].append(res.id)
        else:
            cluster["evidenceIds"].append(rec["request"].id)
        # Cacheability
        if res and res.http.cache and res.http.cache.control:
            ctl = res.http.cache.control
            m = re.search(r"max-age=(\d+)", ctl)
            if m and int(m.group(1)) > 0:
                cluster["cache"] = {"cacheable": True, "ttl": int(m.group(1))}
    # Finalize clusters
    endpoint_list = []
    for cl in clusters.values():
        endpoint_list.append(
            {
                "key": cl["key"],
                "host": cl["host"],
                "pathTemplate": cl["pathTemplate"],
                "methods": sorted(cl["methods"]),
                "params": {
                    "query": sorted(cl["params"]["query"]),
                    "path": cl["params"]["path"],
                },
                "cache": cl["cache"],
                "errors": [
                    {"status": s, "count": c} for s, c in sorted(cl["errors"].items())
                ],
                "evidenceIds": cl["evidenceIds"],
            }
        )
    return endpoint_list


def derive_realtime(events: List[CanonicalEvent]) -> Dict:
    sockets: Dict[str, Dict] = {}
    url_by_id: Dict[str, str] = {}
    for evt in events:
        if evt.type != "ws":
            continue
        if evt.phase == "ws_open":
            req_id = evt.corr.get("cdpRequestId") or evt.id
            url_by_id[req_id] = evt.ws.url
            sockets.setdefault(evt.ws.url, {"url": evt.ws.url, "frameCount": 0})
        elif evt.phase == "ws_frame":
            req_id = evt.corr.get("cdpRequestId")
            url = url_by_id.get(req_id)
            if url:
                sockets[url]["frameCount"] += 1
    return {"sockets": list(sockets.values())}


def derive_third_parties(records: List[Dict]) -> List[Dict]:
    origins = {urlparse(r["request"].http.url.get("raw") or "").netloc for r in records}
    if not origins:
        return []
    site_domain = list(origins)[0]
    third: List[Dict] = []
    added = set()
    for rec in records:
        host = rec["request"].http.url.get("host") or urlparse(
            rec["request"].http.url.get("raw", "")
        ).netloc
        if host == site_domain:
            continue
        provider = None
        for suffix, name in KNOWN_PROVIDERS.items():
            if host.endswith(suffix):
                provider = name
                break
        entry_key = (provider or host, host)
        if entry_key in added:
            continue
        added.add(entry_key)
        third.append({"provider": provider or host, "host": host})
    return third


def derive_performance(records: List[Dict]) -> Dict:
    ttfbs = []
    payloads = []
    for rec in records:
        res = rec.get("response")
        if res and res.http.timing and res.http.timing.ttfb is not None:
            ttfbs.append(res.http.timing.ttfb)
        if res:
            payloads.append(res.http.body.size)
    if ttfbs:
        median_ttfb = statistics.median(ttfbs)
    else:
        median_ttfb = 0
    if payloads:
        payloads.sort()
        idx = int(0.95 * (len(payloads) - 1))
        p95_payload = payloads[idx] / 1024.0
    else:
        p95_payload = 0
    return {"medianTTFB": median_ttfb, "p95PayloadKB": p95_payload}
