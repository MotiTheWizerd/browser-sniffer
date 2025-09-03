from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional

from .derive import (
    derive_auth,
    derive_endpoints,
    derive_performance,
    derive_realtime,
    derive_services,
    derive_site,
    derive_third_parties,
    fuse_http_events,
)
from .ingest import ingest_events
from .models import CanonicalEvent
from .output import emit_summary, write_outputs


class AgentBrain:
    """In-memory implementation of the Agent Brain service."""

    def __init__(self, output_dir: str = ".") -> None:
        self.events: List[CanonicalEvent] = []
        self.profile: Optional[Dict] = None
        self.summary: Optional[str] = None
        self.output_dir = Path(output_dir)

    def ingest(self, data: str) -> Dict[str, int]:
        return ingest_events(data, self.events)

    def build_profile(self) -> Dict:
        if not self.events:
            raise RuntimeError("no events ingested")

        http_records = fuse_http_events(self.events)
        profile = {
            "site": derive_site(http_records),
            "services": derive_services(http_records),
            "auth": derive_auth(http_records),
            "endpoints": derive_endpoints(http_records),
            "realtime": derive_realtime(self.events),
            "thirdParties": derive_third_parties(http_records),
            "risks": [],
            "performance": derive_performance(http_records),
        }
        self.profile = profile
        self.summary = emit_summary(profile)
        write_outputs(self.output_dir, self.profile, self.summary)
        return profile
