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
