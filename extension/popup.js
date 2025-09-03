chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.command === 'start') {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error('No active tab to attach');

        const target = { tabId: tab.id };
        await chrome.debugger.attach(target, '1.3');
        await chrome.debugger.sendCommand(target, 'Network.enable');

        runMeta = { run_id: `run_${Date.now()}`, started_at: Date.now(), counters };
        await storeMeta();
        pendingResponses = new Map();
        activeDebuggers.set(tab.id, { target });

        console.log('Attached to tab', tab.id);
        sendResponse({ ok: true, msg: 'Recording started', tabId: tab.id });
      } else if (message.command === 'stop') {
        // ... existing stop logic ...
        sendResponse({ ok: true, msg: 'Stopped' });
      } else if (message.command === 'export') {
        await exportData();
        sendResponse({ ok: true, msg: 'Export done' });
      } else if (message.command === 'purge') {
        await purgeData();
        sendResponse({ ok: true, msg: 'Purged' });
      }
    } catch (err) {
      console.error('Command failed', err);
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep sendResponse async
});
