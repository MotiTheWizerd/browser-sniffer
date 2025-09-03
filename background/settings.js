// ---- Settings (persisted) ----
export const DEFAULT_SETTINGS = {
  capture: {
    http_assets: false,
    analytics: false,
    ws_small_frames: false,
    request_bodies: true,
    response_bodies: true,
  },
  thresholds: {
    ws_min_bytes: 40,
    body_cap: 128 * 1024,
  },
  host_filters: {
    analytics: [
      'segment.io','api.segment.io','cdn.segment.com',
      'google-analytics.com','analytics.google.com','www.googletagmanager.com',
      'facebook.com','connect.facebook.net','tiktok.com','analytics.tiktok.com',
      'sentry.io','stripe.com','paypal.com'
    ]
  }
};

export let SETTINGS = { ...DEFAULT_SETTINGS };

export async function loadSettings() {
  const s = await chrome.storage.sync.get(['settings']);
  SETTINGS = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    SETTINGS = { ...DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
  }
});
