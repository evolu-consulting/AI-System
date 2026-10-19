---
id: HD7-payments-ledger
title: Lịch thanh toán, sổ nghĩa vụ, quá hạn
milestone: GĐ1 · Luồng B (app mẫu mgmt-app) · CR-094 đợt 3
cr: CR-094
status: building
lane: đầy đủ (tiền + quyền + migration + đường nóng có ngưỡng perf)
requirements: [HD7-FR-01, HD7-FR-02, HD7-FR-03, HD7-FR-04, HD7-FR-05, HD7-FR-06, HD7-FR-07, HD7-FR-08, HD7-FR-09, HD7-FR-10, HD7-FR-11, HD7-FR-12, HD7-NFR-01, HD7-NFR-02, HD7-NFR-03]
design: [docs/platform/intake-hd.md#kế-hoạch-lát (HD7), docs/specs/N1-pack-frame/plan-frontend.md (S06b), docs/specs/HD9-cks/spec-decisions.md (D9-08)]
owner: một agent một lát (Luật 1b)
---

# HD7 · Lịch thanh toán, sổ nghĩa vụ, quá hạn

Nguồn (`R/` = `reference/mgmt-app-contracts/`, đọc thêm bản sống `F:\workspace\mgmt-app\api`): `R/api/app/ledger/{types,obligations,
payments,overdue,events}.py`, `contracts/schedule.py`, `routes/obligations.py`, `routes/partner_events.py`, `cks/{sales,lots,overview}.py`;
test parity `tests/test_{ledger,payments,overdue,schedule}.py`; UI `R/web/src/pages/partners/PartnerLog.tsx` + `ContractPage.tsx:163-181`.
Plan: [plan.md](plan.md).

## 1. Phạm vi
| Làm | Không làm (đâu) |
|---|---|
| Đợt thanh toán/giao hàng (`obligations`), sổ đối tác chỉ thêm (`partner_events` + `partner_event_voids`) | Điểm uy tín / `scoring` đọc sổ (HD8), trang `/partners` (HD8) |
| Lịch mặc định khi HĐ vào trạng thái đã duyệt; `PUT …/schedule` thay lịch | AI đọc điều khoản thanh toán (`schedule.propose`, cần run agent N2 như D2-01) — chỉ port `_sane` |
| Đã thu/Đã trả, Khách hẹn lại, Đã nhắc, Huỷ (hoàn tác), ghi việc tay | "Hẹn nhắc" giờ cụ thể (`followups.py`, `remind_at`/`next_at`) — nợ, cần N3 lịch theo người |
| Vòng quá hạn theo tập, ngày lịch múi tenant (HD4) | Trang "Thanh toán" của web (reference không có màn này; API `/payments` cho trợ lý HD6) |
| `GET /payments`, `/obligations`, `/partner-events`, `/contracts/:id/partner` | |
| CKS: bán/lô/gia hạn lập đợt, mất khách huỷ đợt, `paid` thật (thay D9-08) | |
| S05: khối "Ghi việc với …" + S06b `PartnerLog` (so màn với mgmt-app) | |

## 2. Nghiệp vụ (mọi tiền = bigint đồng; số JSON nguyên ≤ 10¹⁵, tổng = chuỗi thập phân)
| Mã | Điều kiện chính xác |
|---|---|
| HD7-FR-01 | Đợt: `direction` = `receive` khi HĐ `sale`, ngược lại `pay`; `kind` ∈ payment/delivery; `status` ∈ open/done/cancelled/replaced (`replaced` = bị lịch mới thay, ẩn khỏi mọi đọc, như mgmt xoá); `amount` null hoặc 0…10¹⁵. Đối tác: `party_key` = `tax:<chữ số MST>` hoặc `name:<fold(tên)>` của bên mua (bán) / bên bán (mua); không có tên lẫn MST ⇒ null. |
| HD7-FR-02 | HĐ `kind=contract`, `direction` ∈ sale/purchase chuyển từ trạng thái chưa duyệt sang đã duyệt và chưa có đợt (trừ `replaced`) ⇒ 1 đợt `source=default`: hạn = `end_date` ?? `start_date` ?? `signed_date`, tiền = `total_value` (> 10¹⁵ ⇒ null); không có hạn ⇒ không lập. `saneSchedule` (`_sane`): mọi ngày hợp lệ, mọi tiền > 0, \|tổng − giá trị\| ≤ max(1000, giá trị div 1000). |
| HD7-FR-03 | `PUT /contracts/:id/schedule {rows:[{due_date, amount?, kind?}]}` (≤ 120 hàng, writer): đợt `done` giữ; đợt khác ⇒ `replaced`, dòng `overdue` của chúng bị huỷ (người huỷ = hệ thống); đợt mới `seq` = max(seq đã xong)+1…, `source=manual`. Trả mọi đợt còn hiệu lực theo `seq`. |
| HD7-FR-04 | `POST /obligations/:id/settle {at?, amount?}`: chỉ đợt `open` (khác ⇒ 409 `OBLIGATION_DONE`); `at` mặc định hôm nay múi tenant; `done_at=at`; sự kiện `received`/`paid`/`delivered` với `days_late = max(0, at − due)`, `amount = body.amount ?? đợt.amount`. |
| HD7-FR-05 | `POST /obligations/:id/postpone {to, note?}`: chỉ `open` (409); `to ≤ due` ⇒ 422 `POSTPONE_DATE`; `due=to`, `postponed_to=to`, `postpones+1`; sự kiện `postponed {to, was, note}` ngày hôm nay. |
| HD7-FR-06 | `POST /obligations/:id/remind`: chỉ `open` (409); sự kiện `reminded`; `reminders+1`. |
| HD7-FR-07 | `POST /partner-events/:id/void` (writer): đã huỷ ⇒ trả nguyên; `source=system` ⇒ 422 `EVENT_SYSTEM`; ghi một hàng `partner_event_voids` rồi hoàn tác (`undo`): settle ⇒ mở lại nếu đợt đang `done`; postponed ⇒ trả `due=was` nếu đợt chưa xong và `due=to`; reminded ⇒ `reminders−1` (≥ 0). |
| HD7-FR-08 | `POST /partner-events` ghi tay: type ∈ appointment_kept/missed, delivered, complaint, manual_adjust (khác ⇒ 422 `EVENT_TYPE`); `manual_adjust` cần quyền `admin` (403), `delta` nguyên −10…10 ≠ 0 và có `note` (422 `ADJUST_INVALID`); đối tác phải có đợt/sự kiện trong tenant (404). |
| HD7-FR-09 | Vòng quá hạn: đợt `open`, có đối tác, `due < hôm nay` (múi tenant, HD4 `localDate`), `overdue_for ≠ due` ⇒ một sự kiện `overdue` (`at = due+1`, `source=system`, `by` null, `party_late` = (thu ∧ payment) ∨ (trả ∧ delivery), `due_date`, `kind`, `seq`, `amount`), đặt `overdue_for = due`. Hẹn lại rồi lại quá ⇒ ghi lần nữa. Chạy lại ⇒ 0 dòng mới. |
| HD7-FR-10 | Đọc: `/payments?filter=all\|receive\|pay\|overdue\|done` = bảng `payments.board` (chỉ `payment`, `days_late` chỉ đợt mở, `of` = số đợt của HĐ, done = 60 ngày gần nhất, ≤ 500 hàng + `total`); `/obligations` (lọc contract_id, party, status, direction, due_before; kèm `contract_number`); `/partner-events?party=&role=` (kể cả đã huỷ, theo `at`, `id`); `/contracts/:id/partner` → `{party, role, name}`. |
| HD7-FR-11 | CKS: bán/gia hạn/lô lập 1 đợt `source=cks` (tiền = số chữ ký × giá; hạn = ngày ký, gia hạn = hôm nay + 15); mất khách ⇒ đợt mở của HĐ gia hạn `cancelled`. Nhóm bán `paid` = có đợt và mọi đợt `done` (`overview.py:39`). |
| HD7-FR-12 | S05 HĐ đã duyệt có đối tác: khối "Ghi việc với {tên} · khách hàng/nhà cung cấp" + "+ Ghi việc" mở `PartnerLog` (đợt chưa xong, Đã thu/Đã trả, Đã nhắc, Khách hẹn lại, Ghi việc khác, Đã ghi gần đây, Huỷ). Viewer không thấy nút ghi. |

## 3. Quyền, cách ly, hiệu năng
| Mã | Ngưỡng |
|---|---|
| HD7-NFR-01 | Đọc = quyền gói `read`, ghi = `write`, chỉnh tay điểm = `admin`; guard trước đọc thân (viewer POST ⇒ 403, 0 SQL). Tenant khác ⇒ 404/rỗng. 3 bảng mới RLS FORCE (`defineRlsSuite`); sổ + bảng huỷ REVOKE UPDATE/DELETE, đợt REVOKE DELETE. |
| HD7-NFR-02 | Khoá: mọi lệnh ghi khoá hàng HĐ trước (`FOR NO KEY UPDATE`, như HD4 D4-12) rồi tới đợt; vòng quá hạn chỉ khoá đợt `SKIP LOCKED`, không bao giờ chờ ⇒ không vòng chờ với HD4/PATCH. |
| HD7-NFR-03 | Vòng quá hạn lô 500 p95 ≤ 50 ms trên 10.000 đợt quá hạn/tenant (+ nền tenant khác), 2 câu/lô; `GET /payments` p95 ≤ 50 ms với 10.000 đợt; lệnh ghi đợt số câu cố định (≤ 3 sau set_config). Không Seq Scan `obligations`. Báo số thật. |

## 4. Tiêu chí nghiệm thu (parity lấy từ test mgmt-app)
| AC | Given / When / Then |
|---|---|
| HD7-AC01 | `test_payments`: 2 đợt bán 92.500.000 (hôm nay, +30), 1 đợt mua 85.000.000 (−3), 1 đợt 27.000.000 (+5) ⇒ hàng đầu là đợt mua trễ 3 ngày, `of=1`; `pay_open`=112.000.000, `receive_open`=185.000.000, `overdue_count`=1, `overdue_amount`=85.000.000, `due_7d`=119.500.000; lọc receive/overdue; settle ⇒ ra khỏi mở, vào `done`. |
| HD7-AC02 | `test_ledger`: settle 2026-10-13 cho hạn 10-10 ⇒ `paid`, supplier, 3 ngày, 85.000.000; settle lại 409; postpone về trước 422; postpone 10-20 ⇒ `postpones=1`; settle đúng 10-20 ⇒ 0 ngày; lịch mới giữ đợt đã xong. |
| HD7-AC03 | `test_overdue`: hạn 10-01, quét 10-01 ⇒ 0; 10-10 ⇒ 1 dòng `at=10-02`, `party_late`, 350.000; quét lại 0; hẹn 10-20 rồi quét 10-25 ⇒ hạn [10-01, 10-20]; dòng hệ thống huỷ ⇒ 422; lịch mới ⇒ dòng quá hạn cũ bị huỷ, id cũ ⇒ 404. Múi: 2026-10-01T16:59Z vẫn là 10-01 ở VN. |
| HD7-AC04 | Huỷ việc: hẹn lại ⇒ hạn cũ, `postpones=0`; nhắc ⇒ `reminders=0`; đã thu ⇒ mở lại, ghi lại được. Viewer/tenant khác không huỷ được. |
| HD7-AC05 | `test_schedule`: lập mặc định 1 đợt toàn giá trị vào `end_date`, `direction` theo HĐ; HĐ chưa biết bên ⇒ không lập; `_sane` 10.000.000 / 100.000.000 ⇒ không tin. |
| HD7-AC06 | Quyền: viewer GET 200, mọi POST/PUT 403; không Group 403; editor ghi; `manual_adjust` editor 403, owner 200; tenant khác 404/rỗng. |
| HD7-AC07 | CKS: bán 3 chữ ký × 1.650.000 ⇒ đợt 4.950.000 `paid=false`; settle ⇒ `paid=true`; gia hạn mất ⇒ đợt `cancelled`. |
| HD7-AC08 | Perf HD7-NFR-03 đạt, báo số thật. |
| HD7-AC09 | S05/S06b: chữ/khung/ảnh khối Ghi việc khớp mgmt-app (sáng, tối, mobile); thao tác gửi đúng API. |

## 5. Quyết định trong lúc làm
[plan.md §6](plan.md#6-quyết-định).
