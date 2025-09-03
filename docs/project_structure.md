# Extenstion description:
  Architecture
   1. Main Components:
      - Background service worker (background/main.js) as the core
      - Popup UI (popup.html/popup.js) for user controls
      - DevTools integration (devtools.html/devtools.js)
      - IndexedDB storage for captured data

   2. Key Features:
      - HTTP request/response monitoring
      - WebSocket tracking (creation and frame transmission)
      - Data privacy through redaction of sensitive information
      - Event buffering for performance
      - Export functionality to JSON files
      - Storage management with purging capability

  Technical Implementation
   - Uses Chrome Debugger API to capture network events
   - Implements comprehensive data redaction for privacy (emails, phones, JWT tokens, cookies, auth headers)
   - Stores data in IndexedDB with separate stores for events and metadata
   - Provides templating for URLs to normalize IDs/UUIDs
   - Includes timing information for performance analysis

  Privacy Features
  The extension has strong privacy protections:
   - SHA-256 hashing for sensitive data
   - Redaction of personally identifiable information
   - Cookie value masking
   - Authorization header protection
   - Body content truncation for large payloads

# Extension Folder Structure
```
extension/
├── background/
│   ├── buffer.js
│   ├── main.js
│   ├── network.js
│   ├── redact.js
│   ├── runtime.js
│   ├── state.js
│   └── storage.js
├── devtools.html
├── devtools.js
├── manifest.json
├── popup.html
└── popup.js
```