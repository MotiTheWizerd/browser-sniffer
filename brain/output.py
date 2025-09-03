from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Optional


def write_outputs(output_dir: Path, profile: Optional[Dict], summary: Optional[str]) -> None:
    """Write profile and summary files if data is present."""
    if profile:
        (output_dir / "profile.v1.json").write_text(json.dumps(profile, indent=2))
    if summary:
        (output_dir / "summary.md").write_text(summary)


def emit_summary(profile: Dict) -> str:
    """Generate a human-readable summary from a profile."""
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
