document.addEventListener('DOMContentLoaded', async () => {
  const $ = (id) => document.getElementById(id);
  const send = (command) => chrome.runtime.sendMessage({ command });

  const { settings } = await chrome.storage.sync.get(['settings']);
  const s = settings || {};
  const c = s.capture || {};
  const t = s.thresholds || {};
  $('#http_assets').checked = !!c.http_assets;
  $('#analytics').checked = !!c.analytics;
  $('#ws_small_frames').checked = !!c.ws_small_frames;
  $('#request_bodies').checked = c.request_bodies ?? true;
  $('#response_bodies').checked = c.response_bodies ?? true;
  $('#ws_min_bytes').value = t.ws_min_bytes ?? 40;
  $('#body_cap').value = (t.body_cap ?? 128 * 1024) / 1024;

  document.body.addEventListener('change', async () => {
    const next = {
      capture: {
        http_assets: $('#http_assets').checked,
        analytics: $('#analytics').checked,
        ws_small_frames: $('#ws_small_frames').checked,
        request_bodies: $('#request_bodies').checked,
        response_bodies: $('#response_bodies').checked,
      },
      thresholds: {
        ws_min_bytes: Number($('#ws_min_bytes').value) || 40,
        body_cap: (Number($('#body_cap').value) || 128) * 1024,
      }
    };
    await chrome.storage.sync.set({ settings: next });
  });

  $('#start')?.addEventListener('click', () => send('start'));
  $('#stop')?.addEventListener('click', () => send('stop'));
  $('#export')?.addEventListener('click', () => send('export'));
  $('#purge')?.addEventListener('click', () => send('purge'));
});
