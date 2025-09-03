from __future__ import annotations

import json
from typing import Dict, List

from .models import CanonicalEvent


def ingest_events(data: str, events: List[CanonicalEvent]) -> Dict[str, int]:
    """Parse JSONL input and append valid events to the list."""
    added = 0
    seen_ids = {e.id for e in events}
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
        events.append(event)
        seen_ids.add(event.id)
        added += 1
    return {"accepted": added, "total": len(events)}
