# Main Module

`main.py` wires the `AgentBrain` service into a FastAPI application.
It exposes endpoints for monitoring and interacting with the brain:

- `GET /status` – event count and whether a profile exists.
- `POST /ingest` – accept raw JSONL event data.
- `POST /build_profile` – run derivation to produce a profile and summary.
- `GET /profile` – download the generated `profile.v1.json`.
- `GET /summary` – download the markdown summary of findings.
=======
Documentation for the main component of the backend.
