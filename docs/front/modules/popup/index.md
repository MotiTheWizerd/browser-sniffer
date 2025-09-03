# Popup Module

`popup.js` powers the toolbar popup that controls data capture.
Each button sends a command (`start`, `stop`, `export`, `purge`) to the background script via `chrome.runtime.sendMessage`,
allowing users to manage recordings without opening DevTools.
