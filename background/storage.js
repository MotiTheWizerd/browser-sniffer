import { state } from './state.js';

const DB_NAME = 'netprofiler';
const DB_VERSION = 2;
const EVENTS_STORE = 'events_v1';
const META_STORE = 'meta_v1';

let dbPromise = null;

function ensureStores(db) {
  if (!db.objectStoreNames.contains(EVENTS_STORE)) {
    db.createObjectStore(EVENTS_STORE, { autoIncrement: true });
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE, { keyPath: 'key' });
  }
}

export async function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => ensureStores(req.result);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      if (
        !db.objectStoreNames.contains(EVENTS_STORE) ||
        !db.objectStoreNames.contains(META_STORE)
      ) {
        db.close();
        const delReq = indexedDB.deleteDatabase(DB_NAME);
        delReq.onerror = () => reject(delReq.error);
        delReq.onsuccess = () => {
          const retry = indexedDB.open(DB_NAME, DB_VERSION);
          retry.onupgradeneeded = () => ensureStores(retry.result);
          retry.onerror = () => reject(retry.error);
          retry.onsuccess = () => resolve(retry.result);
        };
      } else {
        resolve(db);
      }
    };
  });
  return dbPromise;
}

export async function storeMeta() {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({ key: 'run', ...state.runMeta });
  return tx.complete;
}

export async function flushBuffer() {
  if (!state.buffer.length) return;
  const db = await openDB();
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const store = tx.objectStore(EVENTS_STORE);
  state.buffer.forEach((evt) => store.add(evt));
  state.buffer = [];
  state.lastFlush = Date.now();
}

// Helper function to properly encode Unicode strings to base64
function base64Encode(str) {
  // First convert to UTF-8 bytes
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  
  // Then convert bytes to base64
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function exportData() {
  await flushBuffer();
  const db = await openDB();
  const tx = db.transaction(EVENTS_STORE, 'readonly');
  const store = tx.objectStore(EVENTS_STORE);
  const allEvents = [];
  const hosts = {};
  const payloadSizes = [];
  const ttfbs = [];
  return new Promise((resolve, reject) => {
    store.openCursor().onsuccess = async (e) => {
      const cursor = e.target.result;
      if (cursor) {
        const evt = cursor.value;
        allEvents.push(evt);
        if (evt.http && evt.http.url) {
          hosts[evt.http.url.host] = (hosts[evt.http.url.host] || 0) + 1;
        }
        if (evt.http && evt.http.body && evt.http.body.size) {
          payloadSizes.push(evt.http.body.size / 1024);
        }
        if (evt.http && evt.http.timing && evt.http.timing.ttfb) {
          ttfbs.push(evt.http.timing.ttfb);
        }
        cursor.continue();
      } else {
        const lines = allEvents.map((e) => JSON.stringify(e)).join('\n');
        const data1 = 'data:application/json;base64,' + base64Encode(lines);
        chrome.downloads.download({
          url: data1,
          filename: 'capture.v1.jsonl',
          saveAs: true,
        });
        const stats = {
          run_id: state.runMeta.run_id,
          duration_s:
            state.runMeta.stopped_at && state.runMeta.started_at
              ? (state.runMeta.stopped_at - state.runMeta.started_at) / 1000
              : undefined,
          http_count: state.counters.http_req,
          ws_frames: state.counters.ws_frames,
          hosts: Object.entries(hosts).map(([host, count]) => ({ host, count })),
          p95_payload_kb: percentile(payloadSizes, 95),
          median_ttfb_ms: percentile(ttfbs, 50),
        };
        const statsJson = JSON.stringify(stats, null, 2);
        const data2 = 'data:application/json;base64,' + base64Encode(statsJson);
        chrome.downloads.download({
          url: data2,
          filename: 'stats.v1.json',
          saveAs: true,
        });
        resolve();
      }
    };
    store.openCursor().onerror = () => reject(store.openCursor().error);
  });
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  arr.sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * arr.length);
  return arr[idx];
}

export async function purgeData() {
  const db = await openDB();
  const tx = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
  tx.objectStore(EVENTS_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await tx.complete;
}
