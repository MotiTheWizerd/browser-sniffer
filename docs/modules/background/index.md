# Background Module

Background scripts coordinate data collection:

- `runtime.js` listens for start/stop/export/purge commands and wires Chrome Debugger events.
- `network.js` converts debugger callbacks into canonical HTTP/WebSocket events.
- `redact.js` masks sensitive header values, query params, and payload samples.
- `settings.js` loads and watches user capture preferences.
- `buffer.js` batches events in memory and triggers periodic flushes.
- `storage.js` persists metadata and events into IndexedDB and supports exporting/purging.
- `state.js` holds runtime counters and flags such as buffer size and drop‑body mode.
