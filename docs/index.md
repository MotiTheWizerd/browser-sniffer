# Frontend Documentation

The frontend is a Chrome extension that records network activity for later analysis by the backend service.
It consists of:

- [background](modules/background/) – attaches to the Chrome Debugger, captures events, redacts sensitive data, and stores events in IndexedDB.
- [popup](modules/popup/) – toolbar UI for starting/stopping capture and exporting data.
- [devtools](modules/devtools/) – an optional DevTools panel that reads recent events from IndexedDB.
