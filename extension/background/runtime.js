import { state } from './state.js';
import { storeMeta, flushBuffer, exportData, purgeData } from './storage.js';
import { handleRequest, handleResponse, handleWebSocketCreated, handleWebSocketFrame } from './network.js';

setInterval(() => {
  console.log('Counters', state.counters);
}, 2000);

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.command === 'start') {
    console.log('starting');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      console.warn('No active tab to attach');
      return;
    }
    const target = { tabId: tab.id };
    try {
      await chrome.debugger.attach(target, '1.3');
      await chrome.debugger.sendCommand(target, 'Network.enable');
      state.runMeta = { run_id: `run_${Date.now()}`, started_at: Date.now(), counters: state.counters };
      await storeMeta();
      console.log('Attached to tab', tab.id);
      state.pendingResponses = new Map();
      state.activeDebuggers.set(tab.id, { target });
    } catch (err) {
      console.error('Failed to attach', err);
    }
  } else if (message.command === 'stop') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const dbg = state.activeDebuggers.get(tab.id);
      await chrome.debugger.detach(dbg ? dbg.target : { tabId: tab.id });
      state.activeDebuggers.delete(tab.id);
      state.runMeta.stopped_at = Date.now();
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
      state.pendingResponses.set(params.requestId, params.response);
      break;
    case 'Network.loadingFinished':
      const resp = state.pendingResponses.get(params.requestId);
      if (resp) {
        await handleResponse(resp, params, tabId);
        state.pendingResponses.delete(params.requestId);
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
