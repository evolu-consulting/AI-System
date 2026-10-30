# Entity cards

The distilled layer over the worklogs: who and what a project involves, what they do, and how they
relate. Built 2026-09-30 from fen's pending enhancement of 2026-09-22/23 ("distil the logs").

## Why

A worklog records one turn. A durable fact such as "Elio develops the NodeJS work, Floyd reviews it"
is spread over hundreds of rows, and a model that wants it reads the story of several days. A card
says it once, in about 200 characters.

## A card

| Field | Meaning |
|---|---|
| `name`, `type` | person, system, module, tool, org, rule or other |
| `role`, `purpose` | one line each; replaced when a newer one is given |
| `aliases` | other names; merged |
| `relations` | `[{rel, target}]` such as develops, reviews, owns, depends_on, uses; merged |
| `source_log_ids` | the worklogs it was learned from (last 50); merged |
| `first_seen`, `last_seen` | dates |

One card per (project, folded name): the id is `ent__<project>__<name>`, so writing the same entity
again updates it instead of adding a near-duplicate. Cards live in the project's part
`kh_entity_<project>` (Chroma or HANA alike) and are ordinary vector rows, so `/vector/query` with
`scope=entity` finds them by meaning too.

## Routes

| Route | Permission | Does |
|---|---|---|
| `POST /entities` | project.write | create or update one card |
| `GET /entities/match?text=&project=&limit=8` | signed in; only readable projects | cards named in a text, by folded whole-word match; one line each |
| `GET /entities/{project}/{name}?depth=1` | project.read | a card and the cards its relations reach (max depth 2) |

## Who writes and reads them

KH holds no LLM, so the assistant extracts: the Stop rule asks it, when a turn's log names a person,
system or module with a role or relation, to `POST /entities` too. The prompt rule calls
`/entities/match` with the person's message and uses the lines it returns.

Not done yet: a backfill over existing logs (needs an extraction pass by an assistant).

Checks: `tests/test_entities.py` (19).
