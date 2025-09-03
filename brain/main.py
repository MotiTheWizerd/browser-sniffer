from __future__ import annotations

from fastapi import Body, FastAPI, Response, status
from fastapi.responses import FileResponse, JSONResponse

from .service import AgentBrain

brain = AgentBrain()
app = FastAPI(title="Agent Brain")


@app.get("/status")
def get_status() -> dict:
    return {"events": len(brain.events), "profile": brain.profile is not None}


@app.post("/ingest")
async def ingest(data: str = Body(..., media_type="text/plain")) -> dict:
    result = brain.ingest(data)
    return result


@app.post("/build_profile")
async def build_profile() -> dict:
    profile = brain.build_profile()
    return profile


@app.get("/profile")
async def get_profile() -> Response:
    if not brain.profile:
        return JSONResponse({"error": "profile not built"}, status_code=status.HTTP_404_NOT_FOUND)
    path = brain.output_dir / "profile.v1.json"
    return FileResponse(path, media_type="application/json")


@app.get("/summary")
async def get_summary() -> Response:
    if not brain.summary:
        return JSONResponse({"error": "summary not built"}, status_code=status.HTTP_404_NOT_FOUND)
    path = brain.output_dir / "summary.md"
    return FileResponse(path, media_type="text/markdown")
