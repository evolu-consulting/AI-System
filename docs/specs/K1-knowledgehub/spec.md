---
id: K1-knowledgehub
title: K1 · KnowledgeHub làm RAG ngoài (Hub proxy) + quy trình mẫu AISDLC
milestone: K1
status: draft            # khung — chưa PLAN, chưa readiness, chưa Gate
requirements: [HUB-FR-131, HUB-FR-132, HUB-FR-133, HUB-FR-134, HUB-FR-137, HUB-BR-35, HUB-BR-36, HUB-BR-37, HUB-BR-40]
design:
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-131…134, 137 · HUB-BR-35…37, 40 (ngoại lệ HUB-BR-12)
  - docs/design/agent-hub/ui-agent-studio.md (Cài đặt → KnowledgeHub, Tri thức — thiếu artboard)
  - docs/adr/0012-knowledgehub-external-rag.md (Proposed) · docs/specs/K1-knowledgehub/research-ai-sdlc.md
  - docs/CHANGE-REQUESTS.md#CR-062 · #CR-067 · #CR-068 · #CR-070
  - nền: H4b-1 Secrets (`kh_api_key` theo tenant, `useSecret`) · P-a/P-b2 (`required_sections`, `## Bàn giao`, gate) · H2a (`/mcp`, token job)
owner: backend-lead + frontend-lead + qc
---

# K1 · KnowledgeHub (RAG ngoài)

Khung tách từ BA đã sửa theo Intake Đầy đủ 2026-10-13 (14 mặc định đã chốt). **Chỉ khung**: mục 3–5 do backend-lead/frontend-lead; chưa readiness/Gate. Chạy sau H4b-1.

## 1. Phạm vi
**Làm:**
- Studio → Cài đặt → KnowledgeHub: URL + bảng tenant ↔ namespace + credentials (`kh_api_key` JSON) + "Kiểm tra kết nối" (HUB-FR-131).
- Client KH `/v1/{ns}`: đổi token client credentials, giữ trong bộ nhớ, làm mới 60–90 s, `401` ⇒ thử lại 1 lần (HUB-FR-137).
- Mục "Tri thức" trong agent; `tenant_admin` bật theo công ty + chọn project KH cho quy trình/stage (HUB-FR-132).
- Tool `kh_query` ở `/mcp` → `POST /v1/{ns}/context/step` (4000 ký tự/lần, ≤ 5 lần/stage).
- Ghi `## Tóm tắt` qua `POST /v1/{ns}/worklog`; tự thêm `## Tóm tắt` vào `required_sections` cho quy trình đã chọn project KH (HUB-FR-133).
- Hạ cấp khi KH lỗi (HUB-FR-134); mock KH cho dev/test.
- Seed quy trình mẫu `sdlc-delivery` + `bug-fix` (CR-070, chỉ seed; không sửa `sdlc`).

**Không làm:** nạp nguồn/tài liệu vào KH (K2); code-graph (hoãn, CR-069); tự gắn/xoay ns/client phía KH; tự chèn tri thức vào prompt; dùng `/vector/*` hay khoá chung; thêm KH vào docker-compose; thay đổi phía KH (embedder, parse); dựng canvas/chỉnh template quy trình (P-b2 đã xong).

## 2. Nghiệp vụ
Trỏ BA; chỉ ghi phần cụ thể hoá.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Phiên bản tối thiểu | `GET /version` ≥ v6.4; `GET /v1/capabilities`: `api_versions ∋ v1` + `retrieval` (K2 thêm `packs`) | ADR-0012 §6 |
| Kiểm tra kết nối — lỗi | manifest ns `include_people_lanes=true`; `GET /v1/me` `kind=local`; gọi không token vẫn được (trừ localhost dev); `http://` (trừ localhost dev) | HUB-FR-131, HUB-BR-40 |
| Cảnh báo tĩnh | Embedder đa ngữ (bge-m3) là điều kiện triển khai KH; Hub không đo được | ADR-0012 §8 |
| ns = tenant | Mỗi tenant tối đa một cặp (ns, credentials); run chỉ dùng credentials của tenant mình; tenant khác ⇒ 404 | HUB-BR-35 |
| Project dùng chung | Đánh dấu chỉ đọc: `kh_query` được, không ghi `## Tóm tắt` | HUB-FR-132 |
| `kh_query` | `budget_chars` 4000; ≤ 5 lần/stage (lần 6 ⇒ lỗi tool, không lỗi run); kết quả là dữ liệu | HUB-FR-132, HUB-BR-31 |
| Ghi worklog | subject `<quy trình>/<stage>`; cắt 4000 ký tự; `Idempotency-Key` = run/stage/phiên bản output; `after: auto` ghi khi chốt output, có gate ghi khi Đạt | HUB-FR-133 |
| `## Tóm tắt` | ≤ 200 từ, quá thì cắt; chỉ bắt buộc với quy trình đã chọn project KH | HUB-FR-133 |
| Hạ cấp | Mạng/timeout, `404 ns_not_active`, `423 ns_suspended`, `503 embedder_unavailable` ⇒ chạy tiếp + cảnh báo output + audit | HUB-FR-134 |
| Seed mẫu | `sdlc-delivery` (≤ 10 stage: Scope Sign-off gate → Setup&Plan → Spec gate → Design → Implementation → Code Review → Testing → UAT gate → Release); `bug-fix` (Bug Intake gate → Code Reading → Bug Fix …). Code Review/Testing trượt ⇒ gate người + `back_to_steps`; phỏng cấu trúc `seed.py`, không chép prompt | CR-070 |

## 3. Contract (backend-lead)
<!-- backend-lead -->

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->

## 5. UI (frontend-lead)
<!-- frontend-lead --> Artboard: **thiếu** (Cài đặt → KnowledgeHub, mục Tri thức, chọn project KH ở Evolu Control) — dựng theo mẫu màn Secrets/Cài đặt (`ui-agent-studio`).

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6. Timeout KH gợi ý 5 s (chốt ở PLAN).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| KH v6.4 `/v1` (health, version, capabilities, me, token, context/step, worklog) | Mock KH (`bun run mocks`), kịch bản: ok, 401 hết hạn, 404/423/503, timeout, `include_people_lanes=true`, `kind=local` |
| H4b-1 `useSecret` | Secret thật trong DB test |

**Việc chuyển từ H4b-1 sang K1** (H4b1 plan §2/Q12): (a) mở rộng `usedByMany` của `modules/secrets` thêm `type: knowledge_hub` (H4b-1 trả rỗng) để xoá `kh_api_key` đang dùng ⇒ 409 `SECRET_IN_USE`; (b) kiểm phần `work/<job_id>/` của AC-H4b1-07 (giá trị secret không xuất hiện trong thư mục job) bằng job giả dùng `useSecret`.

Env mới: (backend-lead chốt) allowlist URL KH · timeout.

## 8. Tiêu chí nghiệm thu (qc)
Bản nháp theo BA; qc hoàn thiện ở test-plan.

| AC | Given / When / Then | Test |
|---|---|---|
| K1-AC01 | KH hợp lệ ⇒ "Kiểm tra kết nối" OK; `include_people_lanes=true` / `kind=local` / http ⇒ lỗi nêu nguyên nhân | <!-- qc --> |
| K1-AC02 | Tenant A chạy run ⇒ chỉ credentials ns A; project tenant B ⇒ 404 | <!-- qc --> |
| K1-AC03 | Token chỉ trong bộ nhớ; 401 ⇒ làm mới và thử lại đúng 1 lần; credentials không có trong job/prompt/log/audit | <!-- qc --> |
| K1-AC04 | `kh_query` 5 lần OK, lần 6 lỗi tool; ≤ 4000 ký tự/lần | <!-- qc --> |
| K1-AC05 | Stage có gate: Đạt ⇒ ghi worklog đúng subject + khoá idempotent; trượt ⇒ không ghi; project chỉ đọc ⇒ không ghi | <!-- qc --> |
| K1-AC06 | KH sập / 404 / 423 / 503 ⇒ run tiếp tục, cảnh báo + audit | <!-- qc --> |
| K1-AC07 | Quy trình đã chọn project KH ⇒ `## Tóm tắt` bắt buộc; quy trình khác không đổi | <!-- qc --> |
| K1-AC08 | Seed `sdlc-delivery`, `bug-fix` hợp lệ (≤ 10 stage); 12 file test khoá của `sdlc` không đổi | <!-- qc --> |
| K1-AC09 (chuyển từ H4b-1) | (a) Xoá `kh_api_key` đang được KH trỏ tới ⇒ 409 `SECRET_IN_USE` có `used_by[type=knowledge_hub]`; (b) job giả dùng `useSecret` ⇒ giá trị không xuất hiện trong `work/<job_id>/` (AC-H4b1-07, Q12) | <!-- qc --> |

Lệnh xong: `done:k1` (backend-lead định nghĩa ở PLAN).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-13 · Intake Đầy đủ chốt 14 mặc định: CR-067 (chỉ `/v1/{ns}`, ns = tenant, credentials JSON, token trong bộ nhớ, TLS qua proxy, license), CR-068 (`## Tóm tắt` qua worklog, embedder đa ngữ), CR-069 (K2 thu hẹp), CR-070 (seed mẫu). Khảo sát: [`research-ai-sdlc.md`](research-ai-sdlc.md).
### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
