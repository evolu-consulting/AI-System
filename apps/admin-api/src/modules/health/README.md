# Module health

- FR: `ADM-NFR-06` (hạ tầng M0) — spec `docs/specs/M0-bootstrap/spec.md` §3.1.
- Điểm vào: `healthRoutes(cfg)` trong `health.routes.ts`, mount tại `/health` ở `src/app.ts`.
- `GET /health` → `HealthResponseSchema.parse({ status: "ok", version })`; `version` sai định dạng → ném → 500 `INTERNAL_ERROR` (qc#7).
- Phụ thuộc: `@ai/contracts`. Không chạm DB/Redis (p95 < 20 ms, spec §6). Không có service/repo vì không có nghiệp vụ.
