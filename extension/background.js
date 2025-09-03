const DB_NAME = 'netprofiler';
const DB_VERSION = 1;
const EVENTS_STORE = 'events_v1';
const META_STORE = 'meta_v1';

const FLUSH_COUNT = 250;
const FLUSH_INTERVAL_MS = 2000;
const BUFFER_LIMIT = 5000;
const BODY_CAP = 128 * 1024; // 128KB

let dbPromise = null;
let buffer = [];
let lastFlush = Date.now();
let seq = 0;
let dropBodies = false;

let runMeta = null;
let pendingResponses = new Map();
const activeDebuggers = new Map();

const counters = {
  http_req: 0,
  http_res: 0,
  ws_open: 0,
  ws_frames: 0,
  dropped_bodies: 0,
};

async function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        db.createObjectStore(EVENTS_STORE, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

async function storeMeta() {
  const db = await openDB();
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({ key: 'run', ...runMeta });
  return tx.complete;
}

async function flushBuffer() {
  if (!buffer.length) return;
  const db = await openDB();
  const tx = db.transaction(EVENTS_STORE, 'readwrite');
  const store = tx.objectStore(EVENTS_STORE);
  buffer.forEach((evt) => store.add(evt));
  buffer = [];
  lastFlush = Date.now();
}

function scheduleFlush() {
  if (buffer.length >= FLUSH_COUNT || Date.now() - lastFlush > FLUSH_INTERVAL_MS) {
    flushBuffer();
  }
  if (buffer.length > BUFFER_LIMIT) {
    dropBodies = true;
    console.warn('Buffer high—storing headers only for next events');
  } else {
    dropBodies = false;
  }
}

async function sha256Hex(input) {
  let data;
  if (typeof input === 'string') {
    data = new TextEncoder().encode(input);
  } else {
    data = input;
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function maskEmail(str) {
  return str.replace(/([A-Za-z0-9._%+-])[^@\s]{2,}(@[^\s]+)/g, (m, p1, p2) => `${p1}***${p2}`);
}

function maskPhones(str) {
  return str.replace(/(\d{3})\d{3,}(\d{4})/g, (m, p1, p2) => `${p1}***${p2}`);
}

function maskDigits(str) {
  return maskPhones(str);
}

async function redactString(str) {
  let out = maskEmail(str);
  out = maskDigits(out);
  // JWT
  const jwtRegex = /eyJ[^\.]+\.[^\.]+\.[^\s"']+/g;
  const matches = out.match(jwtRegex) || [];
  for (const token of matches) {
    let alg = 'unk';
    try {
      const header = JSON.parse(atob(token.split('.')[0]));
      alg = header.alg || 'unk';
    } catch {}
    const h = (await sha256Hex(token)).slice(0, 8);
    out = out.replace(token, `jwt.${alg}.${h}`);
  }
  return out;
}

async function redactHeaders(headers = {}) {
  const redacted = {};
  for (const [name, value] of Object.entries(headers)) {
    const lname = name.toLowerCase();
    if (lname === 'cookie') {
      const parts = value.split(';').map((p) => p.trim());
      const masked = await Promise.all(
        parts.map(async (part) => {
          const [k, v] = part.split('=');
          if (!v) return k;
          const hash = (await sha256Hex(v.trim())).slice(0, 8);
          return `${k}=${`<${hash}>`}`;
        })
      );
      redacted[name] = masked.join('; ');
      counters.cookies_masked = (counters.cookies_masked || 0) + parts.length;
    } else if (lname === 'authorization') {
      const hash = (await sha256Hex(value.trim())).slice(0, 8);
      redacted[name] = value.startsWith('Bearer ')
        ? `Bearer <${hash}>`
        : `<${hash}>`;
    } else {
      redacted[name] = await redactString(value);
    }
  }
  return redacted;
}

function maskQuery(query) {
  const out = {};
  const piiKeys = /(email|phone|token|auth|password)/i;
  for (const [k, v] of query.entries()) {
    out[k] = piiKeys.test(k) ? '<redacted>' : v;
  }
  return out;
}

function templatePath(path) {
  return path
    .split('/')
    .map((seg) => {
      if (/^\d+$/.test(seg)) return ':id';
      if (/^[0-9a-fA-F-]{8,}$/.test(seg)) return ':uuid';
      return seg;
    })
    .join('/');
}

async function prepareBody(body, isBase64) {
  if (dropBodies) {
    counters.dropped_bodies++;
    return { kind: 'none', size: 0 };
  }
  if (!body) {
    return { kind: 'none', size: 0 };
  }
  if (isBase64) {
    const bin = atob(body);
    const size = bin.length;
    const hash = await sha256Hex(new TextEncoder().encode(bin));
    return { kind: 'binary', size, hash };
  } else {
    const size = body.length;
    const truncated = body.slice(0, BODY_CAP);
    let sample = await redactString(truncated);
    if (size > BODY_CAP) {
      sample += '...<truncated>';
    }
    const hash = await sha256Hex(body);
    return { kind: 'text', size, hash, sample };
  }
}

async function handleRequest(params, tabId) {
  const urlObj = new URL(params.request.url);
  const query = maskQuery(urlObj.searchParams);
  const headers = await redactHeaders(params.request.headers || {});
  const body = await prepareBody(params.request.postData || '', false);
  const evt = {
    id: `evt_${Date.now()}_${seq++}`,
    plane: 'A',
    type: 'http',
    phase: 'request',
    tabId,
    frameId: params.frameId,
    ts: Date.now() / 1000,
    corr: { cdpRequestId: params.requestId },
    http: {
      method: params.request.method,
      url: {
        raw: params.request.url,
        host: urlObj.host,
        path: urlObj.pathname,
        query,
        template: templatePath(urlObj.pathname),
      },
      headers: { req: headers },
      body,
      initiator: params.initiator
        ? { type: params.initiator.type, url: params.initiator.url }
        : undefined,
    },
  };
  counters.http_req++;
  addEvent(evt);
}

async function handleResponse(response, loadingFinished, tabId) {
  const urlObj = new URL(response.url);
  const headers = await redactHeaders(response.headers || {});
  let body = { kind: 'none', size: 0 };
  try {
    const result = await chrome.debugger.sendCommand({ tabId }, 'Network.getResponseBody', {
      requestId: loadingFinished.requestId,
    });
    body = await prepareBody(result.body, result.base64Encoded);
  } catch (err) {
    console.warn('No body for', loadingFinished.requestId, err.message);
  }
  const evt = {
    id: `evt_${Date.now()}_${seq++}`,
    plane: 'A',
    type: 'http',
    phase: 'response',
    tabId,
    frameId: response.loaderId,
    ts: Date.now() / 1000,
    corr: { cdpRequestId: loadingFinished.requestId },
    http: {
      method: response.requestHeadersText ? response.requestHeadersText.split(' ')[0] : undefined,
      url: {
        raw: response.url,
        host: urlObj.host,
        path: urlObj.pathname,
        query: maskQuery(urlObj.searchParams),
        template: templatePath(urlObj.pathname),
      },
      status: response.status,
      headers: { res: headers },
      body,
      timing: response.timing
        ? {
            dns: response.timing.dnsEnd - response.timing.dnsStart,
            connect: response.timing.connectEnd - response.timing.connectStart,
            tls: response.timing.sslEnd - response.timing.sslStart,
            ttfb: response.timing.receiveHeadersEnd - response.timing.sendEnd,
            download: response.timing.loadingFinished - response.timing.receiveHeadersEnd,
            total: response.timing.loadingFinished - response.timing.requestTime * 1000,
          }
        : undefined,
      cache: {
        fromCache: !!response.fromDiskCache || !!response.fromServiceWorker,
        control: response.headers ? response.headers['cache-control'] : undefined,
        etag: response.headers ? response.headers['etag'] : undefined,
      },
    },
  };
  counters.http_res++;
  addEvent(evt);
}

async function handleWebSocketCreated(params, tabId) {
  const evt = {
    id: `evt_${Date.now()}_${seq++}`,
    plane: 'A',
    type: 'ws',
    phase: 'ws_open',
    tabId,
    frameId: params.requestId,
    ts: Date.now() / 1000,
    corr: { cdpRequestId: params.requestId },
    ws: { url: params.url },
  };
  counters.ws_open++;
  addEvent(evt);
}

async function handleWebSocketFrame(params, tabId, direction) {
  const body = await prepareBody(params.response.payloadData, params.response.opcode !== 1);
  const evt = {
    id: `evt_${Date.now()}_${seq++}`,
    plane: 'A',
    type: 'ws',
    phase: 'ws_frame',
    tabId,
    frameId: params.requestId,
    ts: Date.now() / 1000,
    corr: { cdpRequestId: params.requestId },
    ws: {
      url: params.url,
      direction,
      opcode: params.response.opcode,
      size: body.size,
      hash: body.hash,
      preview: body.sample ? body.sample.slice(0, 300) : undefined,
    },
  };
  counters.ws_frames++;
  addEvent(evt);
}

function addEvent(evt) {
  buffer.push(evt);
  scheduleFlush();
}

async function exportData() {
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
        const blob1 = new Blob([lines], { type: 'application/json' });
        const url1 = URL.createObjectURL(blob1);
        chrome.downloads.download({
          url: url1,
          filename: 'capture.v1.jsonl',
          saveAs: true,
        });
        const stats = {
          run_id: runMeta.run_id,
          duration_s: runMeta.stopped_at && runMeta.started_at ? (runMeta.stopped_at - runMeta.started_at) / 1000 : undefined,
          http_count: counters.http_req,
          ws_frames: counters.ws_frames,
          hosts: Object.entries(hosts).map(([host, count]) => ({ host, count })),
          p95_payload_kb: percentile(payloadSizes, 95),
          median_ttfb_ms: percentile(ttfbs, 50),
        };
        const blob2 = new Blob([JSON.stringify(stats, null, 2)], { type: 'application/json' });
        const url2 = URL.createObjectURL(blob2);
        chrome.downloads.download({
          url: url2,
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

async function purgeData() {
  const db = await openDB();
  const tx = db.transaction([EVENTS_STORE, META_STORE], 'readwrite');
  tx.objectStore(EVENTS_STORE).clear();
  tx.objectStore(META_STORE).clear();
  await tx.complete;
}

setInterval(() => {
  console.log('Counters', counters);
}, 2000);

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.command === 'start') {
    console.log('starting')
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      console.warn('No active tab to attach');
      return;
    }
    const target = { tabId: tab.id };
    try {
      await chrome.debugger.attach(target, '1.3');
      await chrome.debugger.sendCommand(target, 'Network.enable');
      runMeta = { run_id: `run_${Date.now()}`, started_at: Date.now(), counters };
      await storeMeta();
      console.log('Attached to tab', tab.id);
      pendingResponses = new Map();
      activeDebuggers.set(tab.id, { target });
    } catch (err) {
      console.error('Failed to attach', err);
    }
  } else if (message.command === 'stop') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const dbg = activeDebuggers.get(tab.id);
      await chrome.debugger.detach(dbg ? dbg.target : { tabId: tab.id });
      activeDebuggers.delete(tab.id);
      runMeta.stopped_at = Date.now();
      await storeMeta();
      await flushBuffer();
      console.log('Detached from tab', tab.id);
    } catch (err) {
      console.error('Failed to detach', err);
    }
  } else if (message.command === 'export') {
    await exportData();
  } else if (message.command === 'purge') {
    await purgeData();
  }
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const tabId = source.tabId;
  if (!tabId) return;
  switch (method) {
    case 'Network.requestWillBeSent':
      await handleRequest(params, tabId);
      break;
    case 'Network.responseReceived':
      pendingResponses.set(params.requestId, params.response);
      break;
    case 'Network.loadingFinished':
      const resp = pendingResponses.get(params.requestId);
      if (resp) {
        await handleResponse(resp, params, tabId);
        pendingResponses.delete(params.requestId);
      }
      break;
    case 'Network.webSocketCreated':
      await handleWebSocketCreated(params, tabId);
      break;
    case 'Network.webSocketFrameSent':
      await handleWebSocketFrame(params, tabId, 'send');
      break;
    case 'Network.webSocketFrameReceived':
      await handleWebSocketFrame(params, tabId, 'recv');
      break;
    default:
      break;
  }
});