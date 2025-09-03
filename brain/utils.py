from __future__ import annotations

import re

# Known third-party service providers.
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
