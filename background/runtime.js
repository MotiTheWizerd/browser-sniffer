import { state } from './state.js';
import { storeMeta, flushBuffer, exportData, purgeData } from './storage.js';
import { handleRequest, handleResponse, handleWebSocketCreated, handleWebSocketFrame } from './network.js';

const ATTACH_PROTOCOL = '1.3';

// Helper function to create a lock for serializing operations on the same tab
function withLock(tabId, fn) {
  const prev = state.opLocks.get(tabId) || Promise.resolve();
  const next = prev.finally(() => fn()).catch(() => { }); // ensure chain continues
  state.opLocks.set(tabId, next);
  return next;
}

// Check if a tab is actually attached according to Chrome
async function isActuallyAttached(tabId) {
  try {
    const targets = await chrome.debugger.getTargets();
    const t = targets.find(t => t.tabId === tabId);
    return Boolean(t && t.attached);
  } catch (err) {
    console.warn('Failed to get debugger targets', err);
    return false;
  }
}

// Send a command with retry logic
async function cmd(target, method, params, retries = 2) {
  for (let i = 0; ; i++) {
    try {
      return await chrome.debugger.sendCommand(target, method, params);
    } catch (e) {
      if (i >= retries) throw e;
      await new Promise(r => setTimeout(r, 100 + i * 150));
    }
  }
}

// Ensure a tab is attached with proper initialization
async function ensureAttached(tabId) {
  return withLock(tabId, async () => {
    console.log('Attempting to attach to tab', tabId);
    const target = { tabId };
    
    // If already attached according to our state and Chrome, nothing to do
    const inState = state.activeDebuggers.has(tabId);
    const actuallyAttached = await isActuallyAttached(tabId);
    console.log('Tab in our state:', inState, 'Actually attached:', actuallyAttached);
    
    if (inState && actuallyAttached) {
      console.log('Already attached to tab', tabId);
      return;
    }
    
    try {
      console.log('Calling chrome.debugger.attach for tab', tabId);
      // Attach to the debugger
      await chrome.debugger.attach(target, ATTACH_PROTOCOL);
      console.log('Successfully attached to tab', tabId);
      
      // Initialize must succeed or we roll back
      console.log('Calling Network.enable for tab', tabId);
      await cmd(target, 'Network.enable');
      console.log('Successfully enabled Network for tab', tabId);
      
      // Add to our state only after successful initialization
      state.activeDebuggers.set(tabId, { target, attachedAt: Date.now() });
      console.log('Attached to tab', tabId);
    } catch (err) {
      console.log('Error during attach:', err.message);
      // If attach succeeded but init failed, try to detach to avoid zombie state
      try {
        await chrome.debugger.detach(target);
      } catch (_) { }
      
      // Remove from our state
      state.activeDebuggers.delete(tabId);
      throw err;
    }
  });
}

// Safely detach from a tab
async function safeDetach(tabId) {
  return withLock(tabId, async () => {
    console.log('Attempting to detach from tab', tabId);
    const rec = state.activeDebuggers.get(tabId);
    console.log('Our state has tab:', !!rec);
    const target = rec?.target ?? { tabId };
    
    // Check if Chrome thinks it's attached
    const actuallyAttached = await isActuallyAttached(tabId);
    console.log('Chrome thinks tab is attached:', actuallyAttached);
    
    // Only detach if Chrome thinks it's attached
    if (actuallyAttached) {
      try {
        console.log('Calling chrome.debugger.detach for tab', tabId);
        await chrome.debugger.detach(target);
        console.log('Successfully detached from tab', tabId);
      } catch (err) {
        console.log('Error during detach:', err.message);
        // Swallow "not attached" errors; we'll clean state below
        if (!err.message.includes('not attached')) {
          throw err;
        }
      }
    } else {
      console.log('Not calling detach because Chrome says tab is not attached');
    }
    
    // Clean up our state regardless
    state.activeDebuggers.delete(tabId);
    console.log('Detached from tab', tabId);
  });
}

// Reconcile debugger state on startup/resume
async function reconcileDebuggerState() {
  try {
    console.log('Reconciling debugger state');
    const targets = await chrome.debugger.getTargets();
    console.log('Found targets:', targets.length);
    const attachedTabs = targets.filter(t => t.attached && t.tabId).map(t => t.tabId);
    console.log('Attached tabs:', attachedTabs);

    // Rehydrate state for still-attached tabs
    for (const tabId of attachedTabs) {
      // Only add to our state if not already there
      if (!state.activeDebuggers.has(tabId)) {
        state.activeDebuggers.set(tabId, { target: { tabId }, attachedAt: Date.now() });
        console.log('Rehydrated state for tab', tabId);
      }
    }
  } catch (err) {
    console.warn('Failed to reconcile debugger state', err);
  }
}

// Debug function to log state discrepancies
async function debugStates(tabId, label) {
  const ours = state.activeDebuggers.has(tabId);
  const chromeHas = await isActuallyAttached(tabId);
  console.log(`[dbg] ${label} tab=${tabId} ours=${ours} chrome=${chromeHas}`);
}

setInterval(() => {
  console.log('Counters', state.counters);
}, 2000);

// Reconcile on startup
reconcileDebuggerState();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.command === 'start') {
      console.log('Received start command');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        console.warn('No active tab to attach');
        return;
      }

      try {
        console.log('Purging existing data before starting new recording');
        await purgeData();

        console.log('Calling ensureAttached for tab', tab.id);
        await ensureAttached(tab.id);
        state.runMeta = { run_id: `run_${Date.now()}`, started_at: Date.now(), counters: state.counters };
        await storeMeta();
        state.pendingResponses = new Map();
        console.log('Start command completed successfully');
      } catch (err) {
        console.error('Failed to attach', err);
      }
    } else if (message.command === 'stop') {
      console.log('Received stop command');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        console.log('No active tab to detach');
        return;
      }

      try {
        console.log('Calling debugStates for tab', tab.id);
        await debugStates(tab.id, 'pre-detach');
        console.log('Calling safeDetach for tab', tab.id);
        await safeDetach(tab.id);
        state.runMeta.stopped_at = Date.now();
        await storeMeta();
        await flushBuffer();
        console.log('Calling debugStates for tab', tab.id);
        await debugStates(tab.id, 'post-detach');
        console.log('Stop command completed successfully');
      } catch (err) {
        console.error('Failed to detach', err);
      }
    } else if (message.command === 'export') {
      console.log('Received export command');
      await exportData();
    } else if (message.command === 'purge') {
      console.log('Received purge command');
      await purgeData();
    }
  })().finally(() => sendResponse());
  return true;
});

// Clean up whenever Chrome detaches us
chrome.debugger.onDetach.addListener((target, reason) => {
  if (target.tabId) {
    state.activeDebuggers.delete(target.tabId);
    console.log('Chrome detached from tab', target.tabId, 'reason:', reason);
  }
});

// Clean up when tabs are removed
chrome.tabs.onRemoved.addListener((tabId) => {
  state.activeDebuggers.delete(tabId);
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
