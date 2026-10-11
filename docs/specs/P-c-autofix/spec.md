---
id: P-c-autofix
title: P-c · Luồng tự-sửa (autonomous fix) — workspace ghi-được + exec trong container + PR sau duyệt
milestone: P-c (sau H4b)
status: draft            # KHUNG — chưa tới lúc BUILD; chưa chạy spec-readiness
requirements: [HUB-FR-119, HUB-FR-126, HUB-FR-127, HUB-FR-128, HUB-FR-129, HUB-FR-130, WRK-FR-28, HUB-BR-32, HUB-BR-33, HUB-BR-34, WRK-BR-08]
design:
  - docs/CHANGE-REQUESTS.md#CR-061 (Intake Đầy đủ chốt 2026-10-12)
  - docs/design/agent-hub/ba-agent-hub.md §6.10 (HUB-FR-119, 126…130), §7 HUB-BR-32…34
  - docs/design/worker/ba-worker.md (WRK-FR-28, WRK-BR-08, WRK-NFR-02)
  - docs/adr/0011-write-exec-sandbox.md (Proposed)
  - docs/specs/P-b-sources/spec.md (nguồn chỉ-đọc — giữ nguyên)
owner: backend-lead + frontend-lead
---

# P-c · Luồng tự-sửa

> **Chưa tới lúc BUILD — đây là KHUNG.** Mục 3–5, 8 để trống tới khi H4b xong, ADR-0011 chốt và spec-readiness chạy.

## 1. Phạm vi
**Bối cảnh:** `fixbug-evolu` (P-b) chỉ tư vấn trên nguồn chỉ-đọc. P-c cho agent **tự áp bản sửa**: đọc repo → sửa file → chạy test → nhánh/diff → (sau duyệt) PR. Là HUB-FR-119 (CR-061).
**Làm:** workspace ghi-được riêng mỗi job (HUB-FR-126); exec trong container cô lập (127, WRK-FR-28); nhánh + diff (128); mở PR sau gate duyệt (129); quy trình `fixbug-apply` + bật theo tenant + chọn chế độ (130).
**Không làm:** ghi vào `local_path`/repo thật/host/`sources/`; push thẳng nhánh mặc định; đổi hành vi P-b; tự-sửa nguồn ngoài `git_remote` của tenant; allowlist lệnh cứng (bù bằng cô lập).
**Chia pha:** (1) diff-only (chưa cần provider PR) → (2) PR qua API provider.

## 2. Nghiệp vụ
Xem HUB-FR-126…130, HUB-BR-32…34, WRK-FR-28, WRK-BR-08 (không chép). Gate duyệt: HUB-FR-109 / HUB-BR-20; secret `source_credential` của H4b (HUB-FR-68).

## 3–5. Contract · Dữ liệu · UI
<!-- backend-lead --> <!-- frontend-lead --> (chưa làm)

## 6. Rủi ro & hàng rào bảo mật (hard stop)
| Rủi ro | Hàng rào |
|---|---|
| Ghi ra ngoài workspace / vào repo thật | Clone riêng; cấm `local_path`; container chỉ mount workspace rw (HUB-BR-32) |
| Lệnh Bash độc / thoát sandbox | Container mỗi job, không egress (trừ git allowlist), trần CPU/RAM/thời gian/token (HUB-BR-33) |
| Lộ secret | Không secret/token git trong workspace/env; Hub/Runtime tự tạo PR (HUB-BR-34) |
| Áp bản sửa sai | PR luôn sau gate duyệt người; không push nhánh mặc định |
| Lộ chéo tenant | Chỉ `git_remote` của tenant; RLS theo `tenant_id`; tenant khác ⇒ 404 (HUB-BR-14) |
| Prompt injection từ repo | HUB-BR-31 + cô lập mạng + gate duyệt |

## 7. Phụ thuộc & giả lập
H4b (secret `source_credential`, HUB-FR-68) · ADR-0011 chốt + container mỗi job · P-b (driver nguồn, snapshot) · gate duyệt P-a. Giả lập dự kiến: provider PR giả, runtime container giả cho test.

## 8. Tiêu chí nghiệm thu
<!-- qc --> (chờ BUILD; AC-H38… cấp lúc spec hoá)

## 9. Quyết định
### Trước Gate (đã chốt với người dùng, CR-061, 2026-10-12)
| # | Quyết định |
|---|---|
| D1 | CR-061 + spec P-c riêng; P-b (nguồn chỉ-đọc, CR-060) giữ nguyên |
| D2 | Ghi vào clone riêng `work/<job_id>/workspace/<repo>/`; nguồn chỉ-đọc mount riêng; CẤM ghi `local_path`/repo thật/host/`sources/` |
| D3 | Bash/ghi chỉ trong container mỗi job + cắt egress (trừ git allowlist) + trần CPU/RAM/thời gian/token; chưa có container ⇒ P-c chặn |
| D4 | Áp = nhánh + diff → PR qua API provider bằng secret H4b, luôn sau gate (HUB-FR-109); không push thẳng |
| D5 | Chỉ clone `git_remote` của chính tenant; cấm `local_path`; chỉ quy trình do tenant_admin bật |
| D6 | Lệnh test/bash tự do nhưng chỉ trong container không-egress, không secret trong workspace |
| D7 | Mốc P-c sau H4b; ADR-0011 trước BUILD; không đụng P-b |
| D8 | `fixbug-evolu` giữ làm chế độ an toàn; `fixbug-apply` là biến thể mới; người dùng chọn chế độ |
### Trong lúc làm
- (chưa)

## 10. Điểm còn mở (cho spec-readiness lúc BUILD)
1. Container runtime / mạng / trần (ADR-0011) — chưa chốt.
2. Cài phụ thuộc của repo khi không egress (cache/mirror?).
3. Provider PR đầu tiên (GitHub/GitLab?), quyền tối thiểu của `source_credential`, xử lý nhánh trùng tên.
4. Trần mặc định (CPU/RAM/disk/thời gian/token), kích thước repo tối đa khi clone.
5. Hình dạng diff trong output stage + chỗ duyệt trên UI (thiếu artboard).
6. Ánh xạ audit (repo, commit gốc, nhánh, lệnh, kết quả test) vào audit log.
7. Cách `fixbug-apply` chọn repo/branch (đầu vào HUB-FR-124); giới hạn một repo/job?
8. Số AC (AC-H38…) và lệnh `done:pc`.

## 11. Tranh chấp test
- (không)
