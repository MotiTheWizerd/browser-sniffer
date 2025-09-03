# Ingest Module

The ingestion layer reads JSON Lines (`.jsonl`) data produced by the extension and appends valid records to the in‑memory event list.
`ingest_events` skips blank or invalid lines, validates each object against the `CanonicalEvent` model, deduplicates by event `id`,
and returns counts of accepted and total events.
=======
Documentation for the ingest component of the backend.
