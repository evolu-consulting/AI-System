---
id: reviewer-visible
lát: reviewer-visible
cr: CR-109
làn: đầy đủ (RLS)
migration: pack contracts 0070_reviewer_visible (journal idx 66, when 1800200000000)
phụ thuộc:
---
## Plan (ngắn)
Lỗi UAT (tenant evolu, chế độ thấy `org`): vio.ngo thuộc phòng ban (Group) của bước 1 nhưng ngoài cây quản lý của chủ HĐ (thomas) ⇒ mở HĐ "Không tìm thấy", "Việc của tôi" rỗng ⇒ không duyệt được. Nguyên nhân: policy `contracts_visible` (0016) chỉ có nhánh cây quản lý (`org_owner_ids()`), không có nhánh người duyệt; "Việc của tôi" lấy task từ hub rồi lọc nhãn HĐ dưới RLS gói ⇒ bị bỏ. Sửa ở RLS (một chỗ) ⇒ chi tiết HĐ, thẻ duyệt, hàng con (EXISTS qua HĐ) và "Việc của tôi" cùng thấy.

## Làm
- Migration 0070: hàm `contracts.reviewer_contract_ids()` (STABLE, SECURITY DEFINER, `search_path` cố định, không tham số, theo `app.tenant_id`/`app.user_id` như `org_owner_ids()`): (a) task review MỞ của run gói `contracts` chưa kết thúc mà người xem quyết được — cùng luật `openTasksOf` (giao đích danh/chuyển tiếp, Group của task trừ khi có cửa trưởng phòng/người duyệt cụ thể, chính cửa đó, Group chuyển cấp, Group "cũng quyết"; trừ người gửi ở bước `exclude_starter`); (b) task review người xem ĐÃ quyết. Index một phần mới `hub.review_tasks_decided_by_idx (decided_by, tenant_id)`.
- `contracts_visible` (SELECT) = luật 0016 OR `id = any(reviewer_contract_ids())`.
- Policy mới `contracts_visible_upd` (RESTRICTIVE FOR UPDATE, `WITH CHECK (true)`): luật 0016 OR (cờ tx `app.approval_write` = '1' AND người duyệt). Cờ chỉ đặt bởi `approvalWrite()` (approval.repo) ngay trước câu khoá/ghi của lệnh duyệt: `state({lock})`, `markRejected`, `markExtracting`, `byRun({lock})`, `finalize`.
- Hub `/me/review-tasks`: không lọc theo luật thấy của gói (dùng `canAct` của engine) ⇒ đã đúng, không sửa.

## Không làm / Chạm
Không đổi engine/hub, không đổi luật chủ gói/chế độ tenant (`sees_all()`), không mở cho cả Group sau khi task đóng (chỉ "tôi đã quyết"). Không sửa migration ≤ 0069. Không e2e.

## Test tối thiểu
int `tests/acceptance/CF/reviewer-visible.int.test.ts` (đỏ trước: T nhận 404; xanh sau sửa). Chạy lại một lần: `tests/acceptance/CF/*` + `M1c/visibility` + `M1-b2/b2` + `HD8/review-visibility` (43 pass). Không có `*.perf.int.test.ts` cho danh sách HĐ ⇒ ghi chú hiệu năng trong 0070.

## Quyết định trong lúc làm
- Mảng một lần mỗi câu (InitPlan, mẫu `org_owner_ids()`) thay cho hàm theo hàng `is_contract_reviewer(id)`: danh sách HĐ là đường nóng, hàm theo hàng chạy N lần.
- Luật "ai là người duyệt" sao y `openTasksOf` (nguồn "Việc của tôi") ⇒ thấy HĐ ⇔ có việc trong "Việc của tôi"; thành viên Group của bước `head_only` (không phải trưởng phòng) KHÔNG thấy (họ không quyết được).
- Người duyệt chỉ ĐỌC: UPDATE/`FOR UPDATE` của họ chỉ qua lệnh duyệt (cờ `app.approval_write`, như `app.vis_cascade` 0016) ⇒ không sửa trường/gán người qua route khác. `WITH CHECK (true)` để không đổi hành vi giao HĐ cho người ngoài cây (trước đây chỉ SELECT policy, không kiểm hàng mới).
- Hàng con chỉ có policy SELECT theo EXISTS HĐ (nghĩa vụ, mốc, giao dịch…) nay người duyệt cũng đọc được; ghi các bảng đó vẫn chỉ theo tenant + route (chưa chặn riêng ở DB) — ghi vào TECH-DEBT nếu review cuối đợt thấy cần.
- Index `review_tasks_decided_by_idx` đặt trong migration gói (cùng chủ migration với hub, `IF NOT EXISTS`) vì chỉ gói dùng; không thêm migration hub để khỏi tranh số với lát song song.
- Chủ gói (Toàn quyền) vẫn duyệt được mọi bước (giữ prod-fix2, cần người dùng xác nhận).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Người duyệt của bước thấy HĐ cần duyệt ở chế độ hiển thị org
Ở chế độ thấy `org`, ngoài cây quản lý của chủ HĐ, người quyết được một bước duyệt engine đang mở (thuộc Group của bước, được giao đích danh/chuyển tiếp, cửa trưởng phòng/người duyệt cụ thể, Group chuyển cấp, Group "cũng quyết") và người đã quyết một bước của HĐ ĐỌC được HĐ (chi tiết, thẻ duyệt, hàng con) và thấy nó trong "Việc của tôi". Chỉ đọc: không sửa trường/gán người; chỉ lệnh duyệt (Đạt/Chưa đạt/Từ chối/ghi Đã duyệt) ghi được hàng HĐ. Thành viên Group khác của bước đã đóng mà không quyết thì không thấy nữa. Chủ gói và chế độ `tenant` như cũ.
- Kịch bản: khi người thuộc Group bước 1 ngoài cây của chủ HĐ mở HĐ thì nhận 200, thẻ duyệt `can_act`, "Việc của tôi" có HĐ, bấm Đạt thì HĐ Đã duyệt; người chỉ xem ngoài cây vẫn 404, user tenant khác không thấy [test: tests/acceptance/CF/reviewer-visible.int.test.ts » T (Group bước, ngoài cây của B) đọc HĐ + Việc của tôi + Đạt, X và tenant khác 404, đã quyết vẫn đọc, không sửa được]
- Kịch bản: khi người duyệt đã quyết bước thì vẫn đọc được HĐ, còn UPDATE hàng HĐ dưới RLS (ngoài lệnh duyệt) sửa 0 hàng [test: tests/acceptance/CF/reviewer-visible.int.test.ts » T (Group bước, ngoài cây của B) đọc HĐ + Việc của tôi + Đạt, X và tenant khác 404, đã quyết vẫn đọc, không sửa được]

## Việc còn lại
- Người dùng xác nhận: chủ gói (Toàn quyền) vẫn duyệt được mọi bước (prod-fix2).
- Gộp Delta vào `docs/current/sht/cai-dat-va-quyen.md` cuối đợt. Merge/deploy do điều phối (migration 0070 cần chạy trên prod).
