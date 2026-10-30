# 2026-09-30 - Entity cards: the distilled layer over the worklogs

fen's pending enhancement of 2026-09-22/23 (distil the logs into entities, roles, purposes and links),
first version. See docs/entities.md.

- New `app/entities.py`: `POST /entities`, `GET /entities/match`, `GET /entities/{project}/{name}`.
- One card per (project, folded name), lists merged on update, relations walked as a graph.
- Stored as vector rows in `kh_entity_<project>`: no graph database needed, works on Chroma and HANA.
- `app/auth_rules.json`: write needs project.write, match returns only readable projects.
- `tests/test_entities.py` 19/19.

Open: backfill from existing worklogs; the hook text that asks the assistant to write and read cards.
