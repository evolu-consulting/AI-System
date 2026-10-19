---
id: HD3-approval-flow
status: draft
fr: [HD-FR-31, HD-FR-32, HD-FR-33, HD-FR-34, HD-FR-35, HD-FR-36]
nguon: docs/platform/intake-hd.md:50 (HD3), câu 1/3/4/5/8, CR-094 đợt 3, TECH-DEBT #218 #219 #221, N2 ket-luan §5
---
# HD3 · Flow duyệt hợp đồng trên engine N2

Làn **đầy đủ** cho quyền/tenant/engine (HD-FR-31…34), làn nhanh cho màn (HD-FR-35/36). Quyết định: `plan.md` §Quyết định (D3-xx).

## 1. Phạm vi
| Làm | Không làm |
|---|---|
| Def `contracts-approval` do gói dựng cho tenant (`PackRuns.ensureDef`): tool trích → cổng cấp 1 → rẽ nhánh `total_value` → cổng cấp 2 → tool ghi "Đã duyệt" | Sửa ngưỡng qua UI gói (sửa def ở editor admin như mọi def) |
| Agent trích thật (#219): `AgentTransport` = agent Claude **không tool** chạy qua `PackRuns.agent` trên `hub.runs` của stage tool | PDF/ảnh không có văn bản qua agent (D3-04, nợ mới) |
| Run bền thay hàng đợi trong tiến trình (#218) + vòng quét HĐ kẹt `extracting` / run đã kết thúc | Thông báo email/push riêng của gói (N3 có sẵn ở engine) |
| Giới hạn tần suất theo tenant `/extract`, `/manual`, `/approval` (#221) | Trợ lý (HD6), sau duyệt (HD4) |
| contracts-web: S05 "Xác nhận" / "Duyệt" / "Từ chối" (lý do) / "Trích lại"; chat-web: nút Từ chối + 429 theo trần tenant | |

## 2. Yêu cầu
| Mã | Yêu cầu | AC |
|---|---|---|
| HD-FR-31 | Tải lên / nhập tay ⇒ mở run `contracts-approval` (người tải lên = người bắt đầu), gắn `contracts.run_id`. Không mở được ⇒ `extract_failed` mã `FLOW_UNAVAILABLE`/`RUN_LIMIT`, không kẹt `extracting` | AC31a run mở, `run_id` gắn, cùng tenant. AC31b trần tenant đầy ⇒ `extract_failed RUN_LIMIT` |
| HD-FR-32 | Stage `extract` gọi tool `contracts-extract` ⇒ lượt trích HD2 qua agent không tool (job `allowed_tools=[]`, `mcp=null`, gắn `hub.runs` của stage); xong ⇒ `needs_review`, task duyệt cấp 1 (Group `contracts-editor`) | AC32a job agent không tool, kết quả ghi trường. AC32b tool chỉ chạm HĐ có `run_id` = run gọi (run khác / `/mcp` ⇒ lỗi, 0 ghi) |
| HD-FR-33 | Cấp 1 Đạt ⇒ `contracts-value` đọc `total_value` HIỆN TẠI (sau sửa tay); `< 500.000.000` ⇒ bỏ cấp 2; còn lại (kể cả trống) ⇒ cấp 2 (Group `contracts-owner`, `exclude_starter`) ⇒ `contracts-finalize` ghi `active` + `confirmed_at/by` ("Đã duyệt") | AC33a 245 tr ⇒ không task cấp 2, HĐ `active`. AC33b 600 tr ⇒ task cấp 2; người bắt đầu quyết ⇒ 403 `STARTER_CANNOT_REVIEW`; người khác Đạt ⇒ `active` |
| HD-FR-34 | Người bắt đầu không duyệt cấp 2 — kể cả task `decision` của stage đó: chọn `use_current` ⇒ 403 với MỌI lý do (N2-D06 mở rộng, người dùng chốt 2026-10-19). Từ chối (lý do bắt buộc) ở cấp nào ⇒ run `cancelled`, HĐ `rejected` + event ("Bị từ chối"); từ chối ở chat-web ⇒ vòng quét ghi | AC34a decision `permission_lost` ở stage cấp 2, starter `use_current` ⇒ 403. AC34b từ chối không lý do 422; có lý do ⇒ `rejected`. AC34c tenant khác ⇒ 404, viewer ⇒ 403 |
| HD-FR-35 | `/extract`, `/manual`, `/approval` POST: trần theo tenant/ngày (Redis, như tải lên) ⇒ 429 `ACTION_QUOTA {limit, resets_at}`; vòng quét theo tập: `extracting` > 15 phút không run sống ⇒ `extract_failed STALE`; run `cancelled` có reject ⇒ `rejected` | AC35a vượt trần ⇒ 429, 0 run. AC35b quét: số câu SQL cố định mỗi tenant, lô 100 p95 ≤ 50 ms |
| HD-FR-37 | Luật duyệt theo tenant (điều phối 2026-10-19: không là hằng trong def): bảng `contracts.approval_settings` (ngưỡng, khoá Group cấp 1/cấp 2); không có hàng ⇒ mặc định. `contracts-value` so `total_value` với ngưỡng HIỆN TẠI của tenant và trả `level2: "yes"\|"no"` (rẽ nhánh def `level2 eq "no"` ⇒ bỏ cấp 2); Group đọc lúc dựng def và đồng bộ lại vào def khi owner đổi cài đặt (`PUT …/approval-settings`, quyền `admin` gói) | AC37a tenant ngưỡng 100 tr: HĐ 245 tr ⇒ cấp 2; tenant mặc định: 245 tr ⇒ bỏ cấp 2. AC37b đổi Group cấp 2 ⇒ def `approve.after.group_id` = Group mới. AC37c RLS bảng mới (`defineRlsSuite`) |
| HD-FR-36 | FE: S05 thẻ duyệt theo `GET …/:id/approval` (`step`, `can_act`); 429 quy trình ở chat-web hiện `details.max`; nút Từ chối ở thẻ duyệt chat-web | e2e S05 + chat-web; cảnh S05 khớp mgmt-app khi hiện "Xác nhận" |

AC bổ sung (readiness #4/#5/#9/#10): AC33c đúng 500.000.000 ⇒ cấp 2 (`lt` chỉ bỏ khi nhỏ hơn); AC34d người bắt đầu ở cấp 2 cũng không Từ chối/Trích lại (403, `exclude_starter` chặn mọi kết quả review — D3-08); AC34e người khác thuộc `contracts-owner` `use_current` ⇒ được; AC34f tool gọi với `processRunId` null / run khác ⇒ lỗi, 0 hàng; AC34g def `contracts-approval` của acme không chạy được từ beta (404). Người bắt đầu mất quyền ⇒ `permission_lost` (engine); huỷ run (`cancel`) ⇒ HĐ `rejected` + event `cancelled` (lý do "Đã huỷ quy trình").

## 3. Contract (chỉ thêm)
| Endpoint | Quyền | Kết quả |
|---|---|---|
| `GET /pack/contracts/contracts/:id/approval` | `read` | 200 `ContractApproval {run_id, run_status, step: extract\|level1\|level2\|finalize\|done\|rejected\|cancelled\|null, task_id, can_act, feedback}`; HĐ tenant khác ⇒ 404 |
| `POST /pack/contracts/contracts/:id/approval` | `write` + quyền task của engine | body `{action: approve\|reject\|redo, feedback?: 1–4000}`; 200 `ContractApproval`; reject/redo thiếu lý do ⇒ 422 `FEEDBACK_REQUIRED`; không có task duyệt mở ⇒ 409 `APPROVAL_NOT_OPEN`; người bắt đầu ở cấp 2 ⇒ 403 `STARTER_CANNOT_REVIEW`; không thuộc Group ⇒ 403 `NOT_REVIEWER`; trần ⇒ 429 `ACTION_QUOTA` |
| `POST …/:id/extract` (chế độ flow) | `write` | không run sống ⇒ mở run, 202; run sống ⇒ 409 `EXTRACT_BUSY`; trần ⇒ 429 `ACTION_QUOTA` |
| `POST …/manual` | `write` | như HD2 + mở run; trần ⇒ 429 `ACTION_QUOTA` |
`CONTRACT_ERRORS` += `ACTION_QUOTA 429` (details `{limit, resets_at}` như `UPLOAD_QUOTA`), `APPROVAL_NOT_OPEN 409`. Không migration (cột `run_id`, `confirmed_*`, `rejected` + index `contracts_status_idx (tenant_id, status)` có từ HD1).

## 4. Hiệu năng
`GET approval` p95 ≤ 30 ms (1 câu gói + 1 câu hub); `POST approval` p95 ≤ 60 ms không tính kick; mở run lúc tải lên ≤ 60 ms. Quét (D3-09): MỘT lượt cho mọi tenant bật gói: mỗi tenant 1 câu đọc (index `(tenant_id, status)`) + 1 câu `outcomesOf` gộp mọi tenant (`= any`) + mỗi tenant có thay đổi 1 UPDATE theo JSON có điều kiện; lô 100 HĐ p95 ≤ 50 ms (`approval-sweep.perf.int.test.ts`). Trần tần suất: 1 `INCR`+`EXPIRE` pipeline.

## 5. Nguồn giá trị mặc định (HD-FR-37)
| Giá trị | Mặc định | Nguồn |
|---|---|---|
| Ngưỡng cấp 2 | 500.000.000 đ, `total_value ≥ ngưỡng` hoặc trống ⇒ cấp 2 | `intake-hd.md` câu 3 (người dùng chốt 2026-10-18). mgmt-app KHÔNG có (chỉ một bước `confirm`, `ContractPage.tsx:79`) |
| Group cấp 1 | `contracts-editor` | Tự quyết (D3-12): intake câu 3 chỉ nêu tên "Phụ trách HĐ", câu 11 ánh xạ owner/editor/viewer → 3 Group; chọn editor = người phụ trách. **Hỏi người dùng** |
| Group cấp 2 | `contracts-owner` | Tự quyết (D3-12): "Ban giám đốc" ↦ owner. **Hỏi người dùng** |
| Biên đúng ngưỡng | đúng 500.000.000 ⇒ cấp 2 | intake câu 1 "giá trị ≥ ngưỡng ⇒ cấp 2" |
| Trần thao tác / ngày | 100 / tenant (`CONTRACTS_ACTIONS_TENANT_DAY`) | Tự quyết (D3-10). **Hỏi người dùng** |

**Người dùng chốt 2026-10-19:** giữ cả 4 mặc định — editor duyệt cấp 1, owner duyệt cấp 2; 100 lượt AI/tenant/ngày; người bắt đầu không được Từ chối ở cấp 2; Redis lỗi khi đếm trần ⇒ chặn (503). Các dòng "Hỏi người dùng" ở trên và readiness câu (1)(2) đã đóng.

## Quyết định trong lúc làm
Xem `plan.md` §Quyết định.

## Tranh chấp test
(trống)
