from __future__ import annotations

import json
import statistics
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import urlparse, parse_qs

from .models import CanonicalEvent


KNOWN_PROVIDERS = {
    "google-analytics.com": "Google Analytics",
    "googletagmanager.com": "Google Tag Manager",
    "segment.io": "Segment",
    "sentry.io": "Sentry",
    "stripe.com": "Stripe",
    "paypal.com": "PayPal",
    "facebook.com": "Facebook",
    "tiktok.com": "TikTok",
}


class AgentBrain:
    """In-memory implementation of the Agent Brain service."""

    def __init__(self, output_dir: str = ".") -> None:
        self.events: List[CanonicalEvent] = []
        self.profile: Optional[Dict] = None
        self.summary: Optional[str] = None
        self.output_dir = Path(output_dir)

    # ------------------------------------------------------------------
    # Ingestion
    # ------------------------------------------------------------------
    def ingest(self, data: str) -> Dict[str, int]:
        """Parse JSONL input and store valid events."""
        added = 0
        seen_ids = {e.id for e in self.events}
        for line in data.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                event = CanonicalEvent.model_validate(obj)
            except Exception:
                # Skip invalid lines
                continue
            if event.id in seen_ids:
                continue
            self.events.append(event)
            seen_ids.add(event.id)
            added += 1
        return {"accepted": added, "total": len(self.events)}

    # ------------------------------------------------------------------
    # Profile building
    # ------------------------------------------------------------------
    def build_profile(self) -> Dict:
        if not self.events:
            raise RuntimeError("no events ingested")

        http_records = self._fuse_http_events()
        profile = {
            "site": self._derive_site(http_records),
            "services": self._derive_services(http_records),
            "auth": self._derive_auth(http_records),
            "endpoints": self._derive_endpoints(http_records),
            "realtime": self._derive_realtime(),
            "thirdParties": self._derive_third_parties(http_records),
            "risks": [],
            "performance": self._derive_performance(http_records),
        }
        self.profile = profile
        self.summary = self._emit_summary(profile)
        self._write_outputs()
        return profile

    # ------------------------------------------------------------------
    # Output helpers
    # ------------------------------------------------------------------
    def _write_outputs(self) -> None:
        if self.profile:
            (self.output_dir / "profile.v1.json").write_text(
                json.dumps(self.profile, indent=2)
            )
        if self.summary:
            (self.output_dir / "summary.md").write_text(self.summary)

    # ------------------------------------------------------------------
    # Derivation helpers
    # ------------------------------------------------------------------
    def _fuse_http_events(self) -> List[Dict]:
        requests: Dict[str, CanonicalEvent] = {}
        responses: Dict[str, CanonicalEvent] = {}
        for evt in self.events:
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

    def _derive_site(self, records: List[Dict]) -> Dict:
        if not records:
            origin = "unknown"
        else:
            first = records[0]["request"].http
            origin = f"{first.url.get('raw') or first.url.get('host') or ''}"
        ts = datetime.utcnow().isoformat()
        return {"origin": origin, "capturedAt": ts}

    def _derive_services(self, records: List[Dict]) -> List[Dict]:
        counts: Dict[str, int] = defaultdict(int)
        for rec in records:
            host = rec["request"].http.url.get("host") or urlparse(rec["request"].http.url.get("raw", "")).netloc
            counts[host] += 1
        services = [
            {"host": host, "requestCount": count}
            for host, count in sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
        ]
        return services

    def _derive_auth(self, records: List[Dict]) -> Dict:
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

    def _derive_endpoints(self, records: List[Dict]) -> List[Dict]:
        clusters: Dict[str, Dict] = {}
        for rec in records:
            req = rec["request"].http
            url = req.url.get("raw") or req.url.get("path") or ""
            parsed = urlparse(url if url.startswith("http") else f"https://{req.url.get('host', '')}{req.url.get('path', '') or ''}")
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

    def _derive_realtime(self) -> Dict:
        sockets: Dict[str, Dict] = {}
        url_by_id: Dict[str, str] = {}
        for evt in self.events:
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

    def _derive_third_parties(self, records: List[Dict]) -> List[Dict]:
        origins = {urlparse(r["request"].http.url.get("raw") or "").netloc for r in records}
        if not origins:
            return []
        site_domain = list(origins)[0]
        third: List[Dict] = []
        added = set()
        for rec in records:
            host = rec["request"].http.url.get("host") or urlparse(rec["request"].http.url.get("raw", "")).netloc
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

    def _derive_performance(self, records: List[Dict]) -> Dict:
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

    def _emit_summary(self, profile: Dict) -> str:
        lines = ["# Site Profile Summary", ""]
        lines.append(f"Origin: {profile['site']['origin']}")
        lines.append(f"Observed {len(profile['services'])} services.")
        lines.append(
            f"Authentication mode: {profile['auth']['mode']}" + (
                f" (evidence: {', '.join(profile['auth'].get('evidenceIds', []))})"
                if profile['auth'].get('evidenceIds')
                else ""
            )
        )
        lines.append(f"Detected {len(profile['thirdParties'])} third-party hosts.")
        lines.append(f"Captured {len(profile['endpoints'])} endpoints.")
        return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------
# Utility functions
# ----------------------------------------------------------------------
UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
)
SLUG_RE = re.compile(r"[a-z0-9-]{6,}")


def template_path(path: str) -> str:
    """Templatize a URL path according to heuristics."""
    segments = [seg for seg in path.split("/") if seg]
    templated = []
    for seg in segments:
        if seg.isdigit():
            templated.append(":id")
        elif UUID_RE.fullmatch(seg):
            templated.append(":uuid")
        elif SLUG_RE.fullmatch(seg):
            templated.append(":slug")
        else:
            templated.append(seg)
    return "/" + "/".join(templated)
