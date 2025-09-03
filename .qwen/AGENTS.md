
Problem: When visiting a site, we want an automatic network profile: what hosts/endpoints exist, auth mode, realtime sockets, third-parties, and obvious risks.
Solution: A Chrome MV3 extension attaches to the current tab via Chrome DevTools Protocol, captures HTTP+WS traffic with bodies/frames (bounded), redacts sensitive data, stores locally, then exports to a local Agent Brain that builds a profile (JSON + short summary).
Non-Goals (MVP): No Plane B (page hooks), no workers/iframes deep coverage, no OpenAPI emitters, no cloud calls from the extension.
