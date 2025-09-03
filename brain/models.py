from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field, validator


class HTTPBody(BaseModel):
    kind: Literal["json", "text", "binary", "none"] = "none"
    size: int = 0
    hash: Optional[str] = None
    sample: Optional[str] = None


class HTTPTiming(BaseModel):
    dns: Optional[float] = None
    connect: Optional[float] = None
    tls: Optional[float] = None
    ttfb: Optional[float] = None
    download: Optional[float] = None
    total: Optional[float] = None


class HTTPCache(BaseModel):
    fromCache: bool = False
    control: Optional[str] = None
    etag: Optional[str] = None


class HTTPInfo(BaseModel):
    method: str
    url: Dict[str, Optional[str]]
    status: Optional[int] = None
    headers: Dict[str, Dict[str, str]] = Field(default_factory=dict)
    body: HTTPBody = Field(default_factory=HTTPBody)
    timing: Optional[HTTPTiming] = None
    cache: Optional[HTTPCache] = None
    initiator: Optional[Dict[str, str]] = None


class WSInfo(BaseModel):
    url: str
    direction: Optional[Literal["send", "recv"]] = None
    opcode: Optional[int] = None
    size: Optional[int] = None
    hash: Optional[str] = None
    preview: Optional[str] = None


class CanonicalEvent(BaseModel):
    id: str
    plane: Literal["A"]
    type: Literal["http", "ws"]
    phase: Literal["request", "response", "ws_open", "ws_frame", "ws_close"]
    tabId: int
    frameId: str
    ts: float
    corr: Dict[str, str] = Field(default_factory=dict)
    http: Optional[HTTPInfo] = None
    ws: Optional[WSInfo] = None

    @validator("http", always=True)
    def ensure_http_present(cls, v, values):
        if values.get("type") == "http" and v is None:
            raise ValueError("http info required for http events")
        return v

    @validator("ws", always=True)
    def ensure_ws_present(cls, v, values):
        if values.get("type") == "ws" and v is None:
            raise ValueError("ws info required for ws events")
        return v
