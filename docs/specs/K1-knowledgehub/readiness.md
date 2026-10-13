# Readiness — K1-knowledgehub

## Lần 1 · 2026-10-13 · spec-readiness · **NOT READY** (1 Chặn, 8 Cao, 12 Thấp)

Phạm vi: spec, plan, plan-frontend, tasks, test-plan. Không có câu hỏi mới cho người dùng; mặc định đã chấp nhận (Luật 2b) và được áp song song (BE: spec §3/§4/§9 + plan; FE: plan-frontend; docs: dưới đây).

| # | Mức | Vấn đề → cách xử lý đã áp | Nơi sửa |
|---|---|---|---|
| 1 | Chặn | Cột "Test" spec §8 trống ⇒ điền K1-AC01…09 từ test-plan §3; xoá marker `<!-- backend-lead/frontend-lead/qc -->` | spec §8 + toàn file |
| 14 | Thấp | spec.md "Bug Fix …" ⇒ trỏ danh sách stage ở plan §6 | spec §2 Seed mẫu |
| 17 | Thấp | `status: plan`, bỏ câu "Chỉ khung / chưa PLAN" | spec frontmatter + mở đầu, tasks.md dòng 3 |
| 2–13, 15–16, 18–21 | Cao/Thấp | Do backend-lead / frontend-lead xử lý trong spec §3/§4/§9, plan, plan-frontend | xem commit tương ứng |

Kết luận: chưa chạy lại spec-readiness; chạy lần 2 sau khi BE/FE sửa xong.

### Mâu thuẫn tài liệu — sửa SAU Gate (không chặn code)
| Tài liệu | Sửa |
|---|---|
| `docs/design/agent-hub/ui-agent-studio.md:88-89` | (1) bỏ "loại project"; (2) mục Tri thức luôn hiện nhưng khoá khi chưa đủ điều kiện; (3) credentials chọn `secret_id` từ Secrets; (4) kiểm theo hàng tenant |
| BA HUB-FR-134 | Cảnh báo hạ cấp nằm ở `StageView.knowledge`, không sửa output |
| BA HUB-FR-133 | `## Tóm tắt` chỉ áp stage agent có project không chỉ đọc |
| BA HUB-BR-15 | Ghi chú: K1 không nhận khoá nền tảng (secret `kh_api_key` theo tenant) |

## Lần 2 · 2026-10-13 · spec-readiness · **READY** (0 Chặn, 0 Cao, 11 Thấp — đã áp mặc định)

Phạm vi như lần 1 + `test-plan.md`. Không câu hỏi mới cho người dùng. Gate: [`../K1-gate.md`](../K1-gate.md).

| # | Mức | Mặc định đã áp | Nơi |
|---|---|---|---|
| 1 | Thấp | Bước 6–8 kiểm kết nối: non-2xx chưa ánh xạ ⇒ `kh_unreachable {status}`, timeout ⇒ `kh_timeout`, dừng kiểm | plan §3.1 |
| 2 | Thấp | `last_warning` CHECK = `KH_WARNING_CODES` | plan §5 (spec §3.1) |
| 3 | Thấp | `next_at = now() + writeBackoffMs(attempts)` | plan §3.5 |
| 4 | Thấp | Thẻ Tri thức: `available ∧ ¬enabled` ⇒ vẫn gắn project + Alert + [Bật tri thức]; `available=false` ⇒ chỉ lý do (VI/EN §4) | plan-frontend §2, §4 |
| 5 | Thấp | FE bắt buộc chọn secret; BE nhận null ⇒ Kiểm tra 409 `KH_NOT_CONFIGURED` | plan-frontend §2, §8 |
| 6, 8, 10, 11 | Thấp | Chỉnh câu chữ/đối chiếu nhỏ, không đổi hành vi (mặc định = phương án đơn giản nhất, Luật 2) | — |
| 7 | Thấp | plan-frontend `status: plan`; B3/B4 "đóng theo mặc định FE" | plan-frontend §8 |
| 9 | Thấp | `khmock_` chỉ UAT/dev; AC03/AC09 quét `khfake_` | plan §8 |

Ghi chú: các dòng 6, 8, 10, 11 không có chi tiết trong yêu cầu giao việc; nếu cần truy, xem báo cáo spec-readiness lần 2 (không lưu file).

## Phụ lục — 21 lỗ hổng lần 1 (tóm tắt theo nhãn `R#` trong plan.md)

| R# | Nội dung (nơi áp) |
|---|---|
| R1, R14, R15, R17–R19 | Sửa trong spec §3/§4/§9 và plan; không còn nhãn nguyên văn trong plan |
| R2 | `done:k1` chuẩn = test-plan §6 (plan §8) |
| R3 | Gọi khi `disabled` không tính vào 5 lần (plan §3.4) |
| R4 | KH 409 `in_progress` ⇒ cảnh báo `server_error` (plan §3.3/§3.4) |
| R5 | Lưu kết quả kiểm bằng tx ngắn có điều kiện `version` (plan §3.1) |
| R6 | `fetch` mọi lời gọi `redirect:"error"` kể cả token (plan §0, §3.2) |
| R7 | Đổi token client credentials JSON (plan §3.2) |
| R8 | Thứ tự ưu tiên `reason` của `GET /admin/kh` (plan §2.1) |
| R9 | Ánh xạ `SecretUseError` (plan D20) |
| R10 | Câu gợi ý prompt stage nguyên văn (plan D15) |
| R11 | `NOT_CONFIGURED` ↔ `KH_UNAVAILABLE` EN (plan §3.4) |
| R12 | Hiệu lực tool = `payload.mcp.tools` lúc tạo job (plan §3.4) |
| R13 | Đổi `label` không đặt `unchecked` (plan D8) |
| R16 | Export `HandoffShape` (plan §1) |
| R20 | Mock: ns chưa đặt ⇒ `scenario ok` (plan §7) |
| R21 | FK kép `(id, tenant_id)` khi cha có UNIQUE (plan §5) |

Ghi chú: bảng tóm tắt dựng lại từ nhãn trong plan; mức Chặn/Cao/Thấp từng dòng không khôi phục được.
