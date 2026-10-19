# CR-095 · Review cuối đợt + security · phần B (gói hợp đồng, nhập dữ liệu)

Phạm vi: `05ccd514..88f70a73` trên `platform/gd0` (M3, W1, W1b, I1, F1, migration contracts 0009–0014, hub 0042, admin 0014, knowledge 0003–0004).
Ngày: 2026-10-20. Chỉ đọc mã; file này là thay đổi duy nhất.

## Giới hạn của lượt này (đọc trước)

Phần đọc sâu từng lát (máy trạng thái duyệt + bảng ánh xạ HD3, worker Redis Streams + AI client + PDF, W1/W1b, I1) đã giao cho bốn reviewer con.
Lượt phải bàn giao **trước khi** có kết quả của họ, nên file này **chưa** có phát hiện mức mã của các lát đó. Mục "Còn phải review" bên dưới liệt kê
những gì chưa được kiểm. Verdict tính trên phần đã kiểm, không phải trên toàn bộ phạm vi.

## Đã kiểm

- **Thứ tự `when` trong journal:** tăng nghiêm ngặt ở mọi journal được chạm (contracts 0008→0014, knowledge 0002→0004, hub 0041→0042,
  admin 0013→0014, hub-dev 0000→0001). Mọi entry mới đều lớn hơn entry cuối có trước phạm vi ⇒ trên DB đang chạy, migrator Drizzle sẽ áp chúng.
  Lịch sử sau rebase là tuyến tính: từ commit đầu tiên của M3, journal đã ghi `0011_m3_approvals` (M1b giữ `0010`).
- **Migrate trên DB rỗng + int có mục tiêu (evotest, 88f70a73):** `test:int:par` chạy 18 file (HD3 ×6, M3D ×3, W1 ×2, W1B ×2, I1, M3 db-schema,
  ADM-NFR-06 migrate, db migrate, db migrate-hub): **135 pass, 4 fail**. Cả 4 lỗi nằm trong `packages/db/src/migrate-hub.int.test.ts` (phát hiện #1).
  Mẫu DB test dựng bằng cách migrate từ DB rỗng, nên đường fresh-migrate cho cả bốn bộ migration đều xanh. Hub 0042 áp được lên DB stub đã có
  một dòng `usage_logs` cũ (được hub: 41).
- **RLS của bảng mới (mức migration):** `contracts.legacy_records` → `packs.secure_table` + REVOKE UPDATE/DELETE; 6 bảng đồ thị knowledge →
  `packs.secure_table`; bảng admin 0014 → ENABLE RLS kèm policy, closure chỉ ghi qua hàm SECURITY DEFINER có ghim `search_path`, quyền thực thi
  đã REVOKE khỏi PUBLIC. Knowledge 0004: các role `knowledge_search` và `knowledge_api` là NOLOGIN/NOBYPASSRLS, hàm definer ghim `search_path`.
- **F1 (module đóng băng):** khi cờ off, hub-api không mount `/dlc`, `/rooms*`, `/sources`, `/studio/api/kh/connections*` và route công khai của
  quy trình; admin-api không mount workflows/commands/export/import/workflow-tools. Engine và vòng nền vẫn chạy. contracts-web không gọi route
  nào trong số đó (trợ lý dùng `/conversations`, `/runs`). Trong chat-web, `probeEngine` coi 404 là "off" nên `!key` hạ cấp êm.
  mgmt-import là CLI, không dùng `/admin/import`. Không thấy chức năng đang hoạt động nào phụ thuộc route đóng băng.
- **Route W1 (kiểm thử chọn mẫu đầu vào):** `sourcing.routes.ts`, `mywork.routes.ts`: guard chạy trước khi đọc thân; uuid, dòng và thân/query
  strict đều kiểm bằng zod ⇒ đầu vào sai trả 400/404/422, không trả 500.

## Phát hiện

| # | Mức | Lát | Vị trí | Vấn đề | Sửa |
|---|-----|-----|--------|--------|-----|
| 1 | Trung | R1 (migration hub-dev) | `packages/db/src/migrate-hub.int.test.ts:121`, `:144` | Hub-dev đã có `0001_knowledge_login_dev` nhưng test vẫn chờ `hubDev: 1` ⇒ 4 test đỏ trên evotest. Các assert sau dòng 121 (cột usage_logs, unique job_id trên DB stub, có chạm tới thay đổi hub 0042 của M3) **không chạy tới**, nên đường migrate trên DB hiện có của hub 0042 chưa được test này chứng minh. | Đổi số chờ hubDev thành 2 (dòng 121) và kiểm lại số ở lần chạy thứ hai (dòng 144); chạy lại file trên evotest. |
| 2 | Trung | M3 | `tools/scripts/src/m3-close-contract-runs.ts:29` | Script chỉ đặt `expires_at = now()` rồi trông vào vòng hết hạn của engine để đóng run. `HUB_PROCESS_ENGINE` mặc định `off` và không có trong `.env.production.example` ⇒ ở production các run vẫn ở trạng thái active mãi. | Ghi rõ trong runbook là phải bật engine cho một lượt quét, hoặc để script tự đóng run (status/stage/task) trong cùng tx. |
| 3 | Trung | M3 | `tools/scripts/src/m3-close-contract-runs.ts:47-50` | `--apply` vẫn đóng cả run `unmapped` (không có hàng `contracts.approvals` tương ứng) ⇒ duyệt dở dang mất mà không cảnh báo. | Khi `unmapped > 0` thì dừng, trừ khi có `--force`, và in danh sách id. |
| 4 | Thấp | chung (migration) | các `_journal.json` | `when` được đặt tay ở tương lai (knowledge/hub-dev 1794900300000 ≈ 2026-11-17). Migration sinh bằng `drizzle-kit generate` trước ngày đó sẽ có `when` nhỏ hơn ⇒ **bị bỏ qua im lặng** trên DB đang chạy. | Thêm unit test kiểm `when` tăng nghiêm ngặt trong từng journal, hoặc ghi luật "when = max + 86400000" vào CONVENTIONS. |

## Còn phải review (chưa có kết quả trong lượt này)

- M3: máy trạng thái duyệt (ngưỡng 500M theo tenant, editor L1/owner L2, starter chặn ở L2, sửa tiền mở lại, 409 khi đang duyệt, finalize kiểm lại
  trong UPDATE, audit settings, quota 100/ngày, Redis down ⇒ 503); bảng ánh xạ HD3 cũ→mới trong `docs/specs/M3-decouple/tasks.md`; worker Redis
  Streams (reclaim, idempotency, poison message); AI client (trần theo tenant, dòng usage, khoá chỉ lấy từ env); PDF bằng unpdf.
  Lưu ý: `approval-settings.repo.ts:10` và `approval.repo.ts:62` đổi threshold sang `Number(...)`. An toàn với 500M, nhưng cần kiểm cận trên của
  setting khi validate.
- W1/W1b: tính đúng của cache sourcing giữa nhiều instance, phân trang, dedup và SKIP LOCKED của vòng gửi followup, quyền của job role trong 0014.
- I1: tính đúng của ánh xạ, idempotency và checkpoint, tiền chính xác tuyệt đối và làm tròn khớp mgmt-app, ánh xạ duyệt, cách ly profile evotest-mgmt.

## Verdict

**CHANGES_REQUESTED.** Lý do: #1 làm đỏ bộ int, #2–#3 ảnh hưởng tới cutover, và phần review sâu chưa xong.
**Security: chưa kết luận.** Phần đã kiểm (RLS migration, F1, route W1) **SAFE**; các lát M3/W1b/I1 chưa đọc xong mức mã nên chưa cấp SAFE cho toàn đợt.
