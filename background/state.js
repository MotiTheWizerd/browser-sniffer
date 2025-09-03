export const state = {
  buffer: [],
  lastFlush: Date.now(),
  seq: 0,
  dropBodies: false,
  runMeta: null,
  pendingResponses: new Map(),
  activeDebuggers: new Map(), // tabId -> { target, attachedAt }
  opLocks: new Map(),        // tabId -> Promise (prevents races)
  counters: {
    http_req: 0,
    http_res: 0,
    ws_open: 0,
    ws_frames: 0,
    dropped_bodies: 0,
  },
};
