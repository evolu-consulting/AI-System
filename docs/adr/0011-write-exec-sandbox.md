# ADR-0011 · Sandbox ghi + thực thi + container cô lập cho job tự-sửa (P-c)

Trạng thái: **Proposed** (placeholder, chưa chốt; quyết lúc BUILD P-c, trình cùng Gate P-c) · Ngày: 2026-10-12 · CR-061 · Spec: `docs/specs/P-c-autofix/spec.md` · Kế thừa: ADR-0007, WRK-NFR-02, WRK-BR-07/07a

## Bối cảnh
P-b chỉ cho agent Read/Grep/Glob trên snapshot chỉ-đọc, an toàn nhờ hook WRK-BR-07. P-c (HUB-FR-119, 126…130) cần agent **ghi file và chạy lệnh tự do** (test, build) trên clone riêng `work/<job_id>/workspace/`. Hook đường dẫn không đủ cho Bash tự do (HUB-BR-33): phải có container mỗi job. Worker chạy trong WSL2 Ubuntu (WRK-NFR-06). Chưa có container ở repo.

## Vấn đề cần quyết (chưa chốt)
| # | Câu hỏi | Lựa chọn dự kiến | Tiêu chí |
|---|---|---|---|
| 1 | Container runtime | Docker rootless · Podman rootless · gVisor/Firecracker · nsjail/bubblewrap | chạy được trong WSL2; không cần root host; thời gian khởi động; ảnh có công cụ test của repo tenant |
| 2 | Cô lập mạng | `--network none` + proxy git allowlist · egress firewall theo host · không mạng, chỉ mount cache phụ thuộc | không egress (trừ host git allowlist); cài phụ thuộc (npm/pip) khi không mạng thế nào |
| 3 | Trần tài nguyên | cgroup CPU/RAM/pids/disk · timeout cứng · trần token (HUB-FR-115/116) | giá trị mặc định + sửa được; chạm trần ⇒ "Cần người quyết" |
| 4 | Dữ liệu vào/ra | mount workspace rw + `sources/` ro · xuất diff/patch bằng chương trình Runtime | không secret trong workspace/env; token git chỉ ở Runtime/Hub |
| 5 | Vòng đời | một container/job, huỷ sau job; dọn workspace; ảnh nền cố định theo phiên bản | không chia sẻ giữa job/tenant |
| 6 | Thư viện/dịch vụ mới | cần ADR bổ sung phụ thuộc | trình người dùng ở Gate P-c |

## Quyết định
Chưa chốt.

## Hệ quả (dự kiến)
Không có container ⇒ stage tự-sửa bị chặn (hard stop bảo mật); phần diff-only cũng cần container (vì chạy test). Cập nhật WRK-NFR-02/WRK-BR-08 khi chốt.

## Bổ sung (CR-065, 2026-10-12)
Không đổi quyết định hạ tầng; chỉ thêm ràng buộc cho Runtime, không ADR mới.
- **Clone riêng + nhánh:** mỗi job một clone riêng (CR-061 D2); nhánh `ai/<run>/<step>`; trượt duyệt ⇒ commit thêm vào cùng nhánh.
- **Kiểm diff bằng chương trình (WRK-FR-29):** chạy lại test trong container, quét bí mật, allowlist đường dẫn trước khi trả diff; không dùng LLM.
- **Rebase do Runtime:** `main` đổi ⇒ rebase + chạy lại test trong container; xung đột ⇒ "Cần người quyết".
- **Chế độ áp (HUB-BR-34):** `pr` / `auto_merge` (qua auto-merge của provider, chỉ sau gate người Đạt + test Runtime xanh) / `branch_only` (duy nhất cho `local_path`, người tự merge). Token provider chỉ ở Hub/Runtime-chương-trình, không vào container.
- **Giữ:** container mỗi job (HUB-BR-33), cấm ghi `local_path` (HUB-BR-32), Edit/Write + chạy test chỉ trong container.
- Câu hỏi #4 (dữ liệu vào/ra) giờ gồm cả rebase/diff-check; vẫn trình Gate P-c.
