Goal: Automatically profile a website’s network behavior.

Problem: Visiting a site should reveal hosts/endpoints, auth modes, realtime sockets, third-party calls, and obvious risks — without manual digging.

Solution: A Chrome MV3 extension uses the Chrome DevTools Protocol (CDP) to capture HTTP + WebSocket traffic. Events are redacted, stored locally, and exported. A local Agent Brain processes captures into a structured profile (profile.json + summary.md).
Non-Goals (MVP): No Plane B (page hooks), no worker/iframe deep coverage, no OpenAPI emitters, no cloud calls.
Rules
Understand Before Coding
Always read design docs before writing code.
No implementation without knowing its purpose in the system.
Documentation Discipline
docs/ always reflects the current state — clean and up to date.
All changes/decisions/history go only in changelog.md.
Always update project_structure.md when files are added, removed, or reorganized.
Incremental Development
Build in small, composable modules.
Keep files minimal and single-responsibility.
Avoid large monoliths; prefer composition.
Isolation & Encapsulation
No uncontrolled globals.
Each module manages its own state and exposes only explicit interfaces.
Shared data flows only through controlled channels (messages, explicit imports/exports).
Every background file (buffer.js, network.js, etc.) must be self-contained and testable in isolation.
Code Quality
Strict separation of concerns across modules.
Apply redaction and storage rules consistently.
Prioritize clarity, maintainability, and stability over shortcuts.
