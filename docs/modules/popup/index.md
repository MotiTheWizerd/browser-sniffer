# Popup Module

`popup.js` powers the toolbar popup that controls data capture.
It now exposes checkboxes and numeric inputs for filtering options alongside the buttons.
All controls send commands (`start`, `stop`, `export`, `purge`) to the background script via `chrome.runtime.sendMessage` and persist settings to `chrome.storage.sync`.
=======
Documentation for the popup component of the extension.
