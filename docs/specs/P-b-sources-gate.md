# Gate P-b (Nguồn tham chiếu — spec `P-b-sources`)

Ngày: 2026-10-11 · **Người dùng duyệt Gate (không phải tự duyệt).**

Ba quyết định người dùng chốt (ghi tại `P-b-sources/spec.md` §9):
- **D2** — P-b chỉ `git_remote` PUBLIC + `local_path` + `library`; hoãn repo private (`source_credential`) sang mốc nhỏ sau H4b; UI Nguồn không có trường secret.
- **D4 / PB-R05** — Runtime resolve SHA + dựng snapshot; Hub KHÔNG ra internet (lật mặc định "Hub `git ls-remote`"). Cần kênh Hub→Runtime (backend-lead định nghĩa).
- **D7** — Smoke Claude thật chạy bằng agent có trần token (≤ 50k), ép Read/Grep/Glob + hook deny ghi `sources/`; thuộc UAT, không vào CI.

Mặc định Cao #9–#20 (spec-readiness) đã bake vào PB-R07, R10, R15–R22 và AC-PB-04; lệnh xong thêm `done:pa` + `done:pb`.

**Trạng thái:** spec `approved`, sẵn sàng vào PLAN. Còn chờ (#1–#6 Chặn): §3 contract, §4 DDL, §5 UI, §8 AC + test-plan, `plan.md`, `tasks.md` do backend-lead / frontend-lead / qc điền; sau đó chạy lại spec-readiness (Luật 1).

File ngoài cần sửa khi đóng mốc: ROADMAP, P-process-engine §1, ui-admin §7.17, ba-worker WRK-FR-27, CHANGE-REQUESTS CR-060 (liệt kê ở spec §9).
