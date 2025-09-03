# Models Module

Pydantic models enforce the schema for events and their nested structures:

- `CanonicalEvent` represents a single HTTP or WebSocket event with IDs, timestamps, and correlation data.
- `HTTPInfo` captures request/response metadata such as method, URL, headers, body, timing, and cache info.
- `WSInfo` describes WebSocket frames.
- Helper models (`HTTPBody`, `HTTPTiming`, `HTTPCache`) provide structure for nested fields.
Validation ensures that HTTP events include `http` data and WebSocket events include `ws` data.
=======
Documentation for the models component of the backend.
