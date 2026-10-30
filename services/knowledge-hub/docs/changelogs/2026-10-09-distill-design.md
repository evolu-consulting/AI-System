# 2026-10-09 Distill design (roadmap item D)

Design only, no code. `docs/distill-design.md` written from fen's plan of 2026-10-09 and the review
of it. Decisions recorded in KH (project knowledge-hub, topic kh-roadmap-item-d):

- items are ordinary knowledge rows with `kind`, keys `action` + `context` + `entities`, sources
  maintainer-only, `evidence_count`, `status` (proposed, active, contested, superseded, withdrawn);
- a lesson only proposes a policy; fen approves and KH writes the policy row;
- no `kh-users` project: `GET /people` reads Keycloak; no tenant isolation for the lookup;
- soft delete by `knowledge_type`, hard delete only for personal data on withdrawal;
- query by key first (`where action, context`), similarity after; no Kuzu until the bench asks;
- weekend run: `GET /distill/next`, `POST /distill/submit`, `pending` / `approve` / `reject`,
  per-project watermark, leak gate in code, `rekey` of the 367 shared lessons.

Roadmap row D: status "Đang thiết kế".
