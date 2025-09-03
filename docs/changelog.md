# Changelog

## Unreleased
- Added configurable capture filters and thresholds (assets, analytics, WebSocket frames, body toggles) persisted in `chrome.storage`.
- Fixed popup settings init to handle missing storage data and DOM elements gracefully.
- Wrapped background service worker init to avoid registration failures when loading settings.
- Removed duplicate legacy settings logic from popup script causing runtime errors.
- Cleaned up stale conflict markers in documentation.
- Replaced disallowed dynamic import in service worker with static import to restore background functionality.
