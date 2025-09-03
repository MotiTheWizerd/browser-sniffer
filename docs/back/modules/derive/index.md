# Derive Module

Functions in `derive.py` convert ingested events into summarized profile data:

- `fuse_http_events` pairs HTTP request and response events using Chrome Debugger IDs.
- `derive_site` determines the origin of the captured site.
- `derive_services` counts requests per host to highlight backend services.
- `derive_auth` inspects headers for cookies or bearer tokens to infer authentication mode.
- `derive_endpoints` clusters requests into templated endpoints, tracking methods, parameters, cacheability, and errors.
- `derive_realtime` tracks WebSocket connections and frame counts.
- `derive_third_parties` lists external hosts and maps common providers.
- `derive_performance` calculates median time‑to‑first‑byte and the 95th percentile payload size.
