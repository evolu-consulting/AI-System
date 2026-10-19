-- PK-FR-05 · N1 plan §2 "Route admin-api" (T5b, ghi chú T5a): `GET /admin/tenants/:id/packs` liệt kê gói đã cài từ
-- `packs.registry` ⇒ admin-api cần đọc (chỉ SELECT, không ghi; không gì khác trong schema `packs`). Idempotent.
GRANT USAGE ON SCHEMA packs TO admin_api;
--> statement-breakpoint
GRANT SELECT ON packs.registry TO admin_api;
