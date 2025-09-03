# Backend Documentation

The backend "Agent Brain" consumes network events captured by the extension and synthesizes a site profile.  It runs as a FastAPI service and stores results on disk.

## Modules
- [derive](modules/derive/) – transforms raw events into higher‑level insights such as endpoints, auth modes, and performance metrics.
- [ingest](modules/ingest/) – parses JSON Lines input and deduplicates events.
- [service](modules/service/) – orchestrates ingestion and profile generation.
- [output](modules/output/) – writes the profile and human‑readable summary to disk.
- [models](modules/models/) – Pydantic models describing HTTP and WebSocket events.
- [utils](modules/utils/) – helper utilities for provider detection and URL templating.
- [main](modules/main/) – FastAPI entry points exposing the service.
