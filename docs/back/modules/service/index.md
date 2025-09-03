# Service Module

The `AgentBrain` class provides an in‑memory implementation of the backend service.
It maintains the event buffer, builds profiles by invoking functions from `derive.py`,
produces a human‑readable summary, and writes outputs via `output.py`.
Consumers interact with it indirectly through the FastAPI endpoints defined in `main.py`.
