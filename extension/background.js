const activeDebuggers = new Map();

chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  if (message.command === 'start') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      console.warn('No active tab to attach');
      return;
    }
    const target = { tabId: tab.id };
    try {
      await chrome.debugger.attach(target, '1.3');
      await chrome.debugger.sendCommand(target, 'Network.enable');
      console.log('Attached to tab', tab.id);
      activeDebuggers.set(tab.id, { target });
    } catch (err) {
      console.error('Failed to attach', err);
    }
  } else if (message.command === 'stop') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      return;
    }
    const info = activeDebuggers.get(tab.id);
    if (info) {
      await chrome.debugger.detach(info.target);
      activeDebuggers.delete(tab.id);
      console.log('Detached from tab', tab.id);
    }
  }
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (!source.tabId || !activeDebuggers.has(source.tabId)) {
    return;
  }
  switch (method) {
    case 'Network.requestWillBeSent':
    case 'Network.responseReceived':
    case 'Network.webSocketCreated':
    case 'Network.webSocketFrameSent':
    case 'Network.webSocketFrameReceived':
      console.log(method, params);
      break;
    case 'Network.loadingFinished':
      console.log(method, params);
      try {
        const result = await chrome.debugger.sendCommand(source, 'Network.getResponseBody', { requestId: params.requestId });
        const body = result.body || '';
        const truncated = body.slice(0, 128 * 1024);
        console.log('Response body for', params.requestId, truncated);
      } catch (err) {
        console.warn('No body for', params.requestId, err.message);
      }
      break;
    default:
      break;
  }
});
