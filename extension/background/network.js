import { state } from './state.js';
import { addEvent } from './buffer.js';
import { maskQuery, redactHeaders, templatePath, prepareBody } from './redact.js';

export async function handleRequest(params, tabId) {
  const urlObj = new URL(params.request.url);
  const query = maskQuery(urlObj.searchParams);
  const headers = await redactHeaders(params.request.headers || {});
  const body = await prepareBody(params.request.postData || '', false);
  const evt = {
    id: `evt_${Date.now()}_${state.seq++}`,
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
  state.counters.http_req++;
  addEvent(evt);
}

export async function handleResponse(response, loadingFinished, tabId) {
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
    id: `evt_${Date.now()}_${state.seq++}`,
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
  state.counters.http_res++;
  addEvent(evt);
}

export async function handleWebSocketCreated(params, tabId) {
  const evt = {
    id: `evt_${Date.now()}_${state.seq++}`,
    plane: 'A',
    type: 'ws',
    phase: 'ws_open',
    tabId,
    frameId: params.requestId,
    ts: Date.now() / 1000,
    corr: { cdpRequestId: params.requestId },
    ws: { url: params.url },
  };
  state.counters.ws_open++;
  addEvent(evt);
}

export async function handleWebSocketFrame(params, tabId, direction) {
  const body = await prepareBody(params.response.payloadData, params.response.opcode !== 1);
  const evt = {
    id: `evt_${Date.now()}_${state.seq++}`,
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
  state.counters.ws_frames++;
  addEvent(evt);
}
