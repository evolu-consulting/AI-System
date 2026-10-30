# 2026-10-22 Project `source`

A project names the system that made it, so a client lists only its own projects (Rowan: the DLC
frontend showed KH projects that DLC never made, after a sync filled DLC's store).

- `POST /projects` takes an optional `source` (string, at most 64 characters). Missing key, `null`, `""` or
  blank: `"KH"`. A non-string is a 400. A later call that names a source changes it; one that names none keeps it.
- `GET /projects?source=AI-SDLC` lists only that source's projects; without the query, every project as before.
  Every entry now carries `source`.
- Storage: column `projects.source` (sqlite `TEXT NOT NULL DEFAULT 'KH'`, HANA `NVARCHAR(64) DEFAULT 'KH'`),
  added on start when missing; rows made before it read `"KH"`.
- The DLC engine (0.4.1) sends `"AI-SDLC"` when it makes a store project and lists only those.

Test: `tests/test_project_source.py`.
