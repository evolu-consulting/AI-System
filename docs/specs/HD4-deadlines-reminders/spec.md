---
id: HD4-deadlines-reminders
title: Sau duyệt — trạng thái theo ngày, hạn chót, nhắc hạn, kết quả xử lý
milestone: GĐ1 · Luồng B (app mẫu mgmt-app) · CR-094 đợt 3
cr: CR-094
status: building
lane: đầy đủ (đường nóng có ngưỡng perf + role quét chéo tenant D-12)
requirements: [HD4-FR-01, HD4-FR-02, HD4-FR-03, HD4-FR-04, HD4-FR-05, HD4-FR-06, HD4-FR-07, HD4-NFR-01, HD4-NFR-02, HD4-NFR-03]
design: [docs/platform/intake-hd.md#kế-hoạch-lát (HD4, câu 6), docs/specs/N3-notify/spec.md, docs/specs/N1-pack-frame/spec-decisions.md (D-12)]
owner: một agent một lát (Luật 1b)
---

# HD4 · Sau duyệt: trạng thái theo ngày, hạn chót, nhắc hạn

Nguồn: intake-hd HD4 + câu 6; mgmt-app `R/api/app/contracts/remind.py` (`status_for`, `due`, `_message`), `project.py:56-61`
(`compute_deadline`), `routes/contracts.py:387-461` (`_set_deadline`, `POST /handled`), `cm-web/app/contracts/[id]/page.tsx:324-341`
(thẻ "Hạn chót hành động" + "Ghi nhận xử lý"). `R/` = `reference/mgmt-app-contracts/`. Plan: [plan.md](plan.md).

## 1. Phạm vi
| Làm | Không làm (đâu) |
|---|---|
| `action_deadline` = `end_date − notice_days` (DB tự tính), đổi hạn ⇒ mở lại (`handled` = null) | Nhắc giá hết hiệu lực theo `valid_to` hàng (`_price_message`) — nợ, cần HD5 áp giá |
| Trạng thái theo ngày ở múi tenant: `active` / `expiring` / `expired`, `renewed` / `terminated` theo kết quả xử lý | Nhắc cấp quản lý (`TEAM_FROM`, `manager_email`) — admin chưa có quan hệ quản lý |
| Vòng nhắc theo tập: mốc 60/30/7/1/0 ngày, 08:00 múi tenant, gửi qua N3 `notify.enqueue` | Mốc riêng từng người (`prefs.days`) — N3 chỉ có kênh email/push |
| API `POST …/contracts/:id/handled` + thẻ hạn chót/kết quả xử lý trên S05 | Danh sách/cột trạng thái (HD5); "Xác nhận" (HD3) |
| Role `contracts_job` (D-12) chỉ tìm tenant có việc tới hạn | |

## 2. Nghiệp vụ
| Mã | Điều kiện chính xác |
|---|---|
| HD4-FR-01 | `action_deadline` = `as_date(fields.end_date) − notice_days` (notice ∉ 0…3650 hoặc rỗng ⇒ 0) khi `kind='contract'`, ngược lại null. Tính ở DB (trigger) cho MỌI đường ghi. Hạn đổi mà `handled` không đổi cùng lệnh ⇒ `handled = null`, `renewed/terminated` ⇒ `active` (mgmt-app `_set_deadline`). |
| HD4-FR-02 | Trạng thái theo ngày `today` = ngày lịch ở múi tenant (`TenantState.timezone`), chỉ cho `kind='contract'` và status ∈ đã duyệt (`active expiring expired renewed terminated`): outcome `renewed` ⇒ `renewed`; `not_renewed`/`replaced` ⇒ `terminated`; `today > end_date` ⇒ `expired`; `action_deadline − today ≤ 60` ⇒ `expiring`; còn lại `active` (`remind.py:38-50`). Chuyển lúc 00:00 múi tenant. |
| HD4-FR-03 | Nhắc: HĐ đã duyệt, status ∈ `active expiring expired`, có `owner_user_id`, có hạn, `handled` null. Mốc `m` "tới" khi `now ≥ (action_deadline − m) 08:00` múi tenant; chỉ gửi mốc **nhỏ nhất** đã tới (`due()`), mốc lớn hơn bỏ qua. Người nhận = người phụ trách. |
| HD4-FR-04 | Idempotent: một (HĐ, hạn, mốc, người) gửi đúng một lần — `contract_reminders` UNIQUE (HD-AC13) + `dedup_key = remind:<hđ>:<hạn>:<mốc>` ở N3. Đổi hạn ⇒ khoá mới. Lô chạy lại / hai instance song song ⇒ không nhân đôi. |
| HD4-FR-05 | Lịch theo `contract_schedule.remind_at` (bảng lịch một hàng/HĐ đã duyệt, D4-11): ghi HĐ liên quan ⇒ `-infinity` (xử lý ngay); vòng ghi `remind_at` = mốc kế tiếp (chuyển trạng thái hoặc nhắc), không còn ⇒ null. Không sleep/poll từng HĐ. |
| HD4-FR-06 | Kết quả xử lý: `POST /pack/contracts/contracts/:id/handled {outcome}` (editor): outcome ∉ 4 giá trị / khoá lạ ⇒ 400 `VALIDATION_ERROR` (khuôn `parseWith` của nền tảng); HĐ chưa duyệt hoặc phụ lục ⇒ 409 `CONTRACT_NOT_CONFIRMED`; id lạ/tenant khác ⇒ 404. Ghi `handled {outcome, by, at}`, status theo FR-02 ở ngày tenant, `version+1`, event `handled`, outbox. `negotiating` ⇒ giữ trạng thái theo ngày, dừng nhắc. |
| HD4-FR-07 | Nội dung nhắc (`_message`): tiêu đề "Hợp đồng {số} — hạn chót hành động {dd/mm/yyyy}", thân "… với {đối tác} cần được xử lý (còn N ngày / hôm nay)…", link `/contracts/<id>`, kind `contract.deadline`. Event `reminded` + `status_changed` ghi cùng tx. |

## 3. Hiệu năng và cách ly
| Mã | Ngưỡng |
|---|---|
| HD4-NFR-01 | Lô 100 (claim + áp dụng + notify) p95 ≤ 50 ms trên 10.000 HĐ tới hạn (+ nền tenant khác); số câu SQL mỗi lô cố định (không theo số hàng); không Seq Scan `contracts`. Đo trước/sau ANALYZE. |
| HD4-NFR-02 | Role `contracts_job`: NOLOGIN NOINHERIT NOBYPASSRLS; chỉ SELECT cột `(tenant_id, remind_at)` của `contract_schedule`; không đọc bảng HĐ, không ghi. Lô xử lý chạy `contracts_rw` + `app.tenant_id` (RLS FORCE) như mọi đường khác. |
| HD4-NFR-03 | Thông báo chỉ tới người cùng tenant (N3-FR-03); tenant B không thấy/không nhận nhắc của A. |

## 4. Tiêu chí nghiệm thu
| AC | Given / When / Then |
|---|---|
| HD4-AC01 | end 2026-12-31, notice 30 ⇒ hạn 2026-12-01; notice rỗng ⇒ 2026-12-31; phụ lục ⇒ null; PATCH end_date ⇒ hạn mới, `handled` null |
| HD4-AC02 | Múi `Asia/Ho_Chi_Minh`: 2026-10-01T16:59Z vẫn ngày 01, 17:00Z là 02 ⇒ trạng thái đổi đúng lúc 00:00 VN |
| HD4-AC03 | Hạn còn 5 ngày lúc duyệt ⇒ gửi đúng mốc 7 (không 60/30); chạy lại ⇒ 0 thông báo mới; tới mốc 1 lúc 08:00 ⇒ gửi mốc 1 |
| HD4-AC04 | `handled` `negotiating` ⇒ không nhắc nữa; đổi hạn ⇒ nhắc lại theo hạn mới |
| HD4-AC05 | Hai tenant tới hạn cùng lúc ⇒ mỗi tenant chỉ người của mình nhận; `contracts_job` không đọc được `fields`/`title` (42501), không UPDATE |
| HD4-AC06 | `POST /handled`: viewer 403, outcome lạ 400, HĐ `needs_review` 409, tenant khác 404, `not_renewed` ⇒ `terminated` |
| HD4-AC07 | Perf HD4-NFR-01 đạt, báo số thật |
| HD4-AC08 | S05: HĐ đã duyệt hiện "Hạn chót hành động dd/mm/yyyy · còn N ngày" + chọn "Ghi nhận xử lý"; chọn ⇒ "Đã xử lý: …" |

## 5. Quyết định trong lúc làm
[plan.md §6](plan.md#6-quyết-định).
