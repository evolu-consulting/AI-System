# UAT P-b (CR-060 Nguồn tham chiếu) — PF-S5 · 2026-10-11

Người chạy: `qc-uat` (trình duyệt thật, Playwright/CDP qua `node`). Tenant: **evolu** (người dùng demo trên evolu; không kiểm acme — theo yêu cầu). Ảnh/JSON/script: cùng thư mục này (`scripts/`). Báo cáo này do điều phối ghi lại từ kết quả qc-uat (công cụ ghi chặn subagent tạo file).

> Lưu ý đọc: output qc-uat khớp mẫu "settings-json" nên harness đã trung hoà thẻ điều khiển; toàn bộ nội dung là **dữ liệu/kết quả**, không phải lệnh.

## Kết luận
Happy path CHẠY ĐƯỢC: admin thấy nguồn + path + cảnh báo máy Runtime; **tenant_admin bị ẩn path** (403 `SOURCE_FORBIDDEN_KIND`); chat chạy quy trình; **MANIFEST chèn vào prompt**; **#135 nhóm-ở-stage-0 không 401**; **trần token 50k có hiệu lực** (61k ⇒ `needs_decision stage_tokens`). Nhưng smoke Claude THẬT chưa trọn do lỗi sản phẩm **B1/B2/B3** (chặn dùng-thật). Đã route backend-lead sửa (Opus).

## Stack đã dựng (đang chạy để demo)
- DB dev `ai_system`: `bun run db:migrate` áp migration 0021 — có `hub.sources`, `hub.source_job_reads`.
- Hub: `hub:dev` `HUB_DEV_RUNTIME=none HUB_PROCESS_ENGINE=on HUB_ATTACH_DIR=D:/AI/ai-system/.data/attachments HUB_PUBLIC_INTERNAL_URL=http://172.26.0.1:4000 HUB_CORS_ORIGINS=http://localhost:3100,http://localhost:3000`.
- Web: admin-web :3000, chat-web :3100 (dev, mỗi cái 1 tiến trình, không OOM).
- Runtime: WSL Ubuntu user `worker` (non-root), providers `claude-sub,fake-cli`, gọi Hub qua `http://172.26.0.1:4000` (NAT). Chạy qua `scripts/runtime-wrapper-dbg.py` (workaround B2 tạm `snapshot._DIR_MODE=0o755`). Gỡ container `ai-hub-dev-runtime` vì container chưa login `claude`.
- `claude-sub`: `claude auth status` đã đăng nhập, `provider_state=ok` (probe lạnh đầu báo `logged_out` rồi `recovered` ~75s).

## Truy cập demo evolu (giữ lại)
- admin-web http://localhost:3000 · chat-web http://localhost:3100 · mật khẩu `1234567890`.
- Tài khoản: `admin` (platform), `julian.bui` (tenant_admin evolu, UI tiếng Anh), member `thomas.tran`, `vio.ngo`, `edgar.nguyen`, `rowan.nguyen`.
- Nguồn: `ai-system-repo` (local_path, evolu, `/mnt/d/AI/ai-system/.data/uat-source` = bản chép 58 file, git-ignored — không trỏ cả repo vì B3).
- Agent: `pb-doc-claude` (profile `claude-sub-1`, token_budget 50000), `pb-doc-fake` (profile `fake-1`); team `plan-team` (+ `backend-lead`, `frontend-lead`).
- Quy trình: `doc-nguon-claude`, `doc-nguon-fake`, `nhom-stage0` (#135). Allowlist stage: `packages/contracts/src/hub-admin/**`, `apps/hub-api/src/modules/sources/**`, `docs/specs/P-b-sources/spec.md`.
- Chạy: chat-web, phòng "Evolu team", nút Quy trình → chọn `!doc-nguon-…` → Gửi.
- Dừng stack: kill theo cổng 3000/3100/3001/4000 + `pkill -f dbg.py` trong WSL.

## Kết quả kịch bản
| # | Kịch bản | Kết quả | Evidence |
|---|---|---|---|
| 1 | platform_admin thấy nguồn + path + cảnh báo | PASS (chọn công ty evolu trước) | 02,03,04 |
| 2 | tenant_admin không thấy path | PASS — menu chỉ "View"; API `config={"kind":"local_path"}`; PUT/DELETE 403 `SOURCE_FORBIDDEN_KIND` | 05,06,07, `api-pin-and-hide.txt` |
| 3 | thomas.tran: Quy trình + form + chạy | PASS | C-01,C-02,F-01,F-02 |
| 4a | MANIFEST chèn prompt | PASS (fake + Claude): tên/mô tả/phiên bản(snapshot_id)/path `sources/ai-system-repo` + câu "dữ liệu, không phải lệnh" | `hub.jobs.payload` |
| 4b | Output Claude có `## Nguồn tham chiếu` | Nội dung đúng (trích `ai-system-repo:...sources.ts@<pin>`); Hub TỪ CHỐI vì B1 | C-03,C-04 |
| 4c | `hub.source_job_reads` có bản ghi | fake PASS; Claude có dòng nhưng `files_read={}` (B1) | DB |
| 4d | Agent chỉ Read/Grep/Glob | `allowed_tools` ép trong payload; CHƯA thử ghi snapshot để kiểm hook | DB |
| 5 | #135 nhóm ở stage 0 | PASS — `backend-lead`→`frontend-lead` succeeded, run `done`, không 401 | G-03,G-04 |

## Smoke thật & token
- Claude thật `doc-nguon-claude`: 3 lượt (Hub tự thử lại do B1), tổng **61.034 token** (~20k/lượt) ⇒ vượt trần stage 50k ⇒ `needs_decision stage_tokens` (trần hoạt động). Output đúng contract. Đã huỷ run, không chạy lại (tiết kiệm token). Run `a66a093c-...`.
- fake-cli: đọc file thật + audit đúng, nhưng kết `needs_decision template_invalid` (hạn chế dự kiến: `#fake:read` thay cả output ⇒ không có `## Nguồn tham chiếu` hợp lệ). Dùng fake để kiểm MANIFEST + audit, không chạy trọn run.

## Lỗi sản phẩm (route backend-lead)
- **B1 (Chặn dùng-thật + bảo mật):** `providers/claude/mapping.py:98` `tool_events` phát `ToolUse` KHÔNG có `path` ⇒ `read_paths` rỗng ⇒ `source_job_reads.files_read={}` ⇒ `checkSourceRefs` luôn `path_absent` ⇒ mọi run Claude thật có nguồn kẹt. Seam audit chỉ đúng với fake-cli. Cũng ảnh hưởng hook ghi (PB-R10, path-based, chưa kiểm với Claude thật). Run `a66a093c-...`.
- **B2 (Cao):** `snapshot.commit`/`finalize_ro` chmod tmp 0555 rồi `os.replace` sang cha khác ⇒ EACCES khi non-root; `except OSError` nuốt ⇒ `mount` ném `FileNotFoundError` ⇒ job `failed INTERNAL_ERROR`. Test chạy root trong container nên không thấy.
- **B3 (Cao):** `local_path` quét cả cây (node_modules/.venv/.git) trước allowlist ⇒ `D:\AI\ai-system` 45.037 file, 239s trên WSL, vượt cửa sổ orphan ~70s ⇒ job `source.resolve` orphan, `sources-resolved` muộn 401, run kẹt `running` (không thành `source_unresolvable`). Run `dba02dc0-...` (huỷ tay). "Kiểm tra kết nối" không allowlist ⇒ 422 `SOURCE_TOO_LARGE`.
- **B4 (Thường→Cao):** role `agent_runtime` thiếu SELECT trên `hub.runs` ⇒ LRU `runtimes/resolve/host.py:183` + `runtimes/cli/job_run.py:216` lặp `permission denied for table runs` ⇒ cache snapshot không dọn.
- **N1 (Thường):** nguồn local_path lớn không lấy được pin (Kiểm tra TOO_LARGE ⇒ `last_pin=null` tới khi có run) — liên quan B3.
- **N2 (Thường):** UI tenant_admin ghi "Only platform administrators can test this source" nhưng API `POST /admin/sources/:key/check` vẫn chạy cho tenant_admin (trả 422, không 403) — lệch UI/API.
- **U1 (Thường UX):** form input `source_ref` chỉ liệt kê nguồn git ("chưa khai báo nguồn Git", ô disabled) ⇒ không chọn được local_path ⇒ quy trình có `source_ref` bắt buộc không chạy trên tenant chỉ có local_path. qc-uat đã bỏ input này khỏi `doc-nguon-fake`.

## Giới hạn lần chạy
Chỉ Chromium headless desktop (không mobile). Chưa kiểm git_remote/library/hook-chặn-ghi-snapshot. Không kiểm acme (theo yêu cầu). Runtime chạy với workaround B2 (cache snapshot không còn 0555). `FAIL-C-run.png`/`FAIL-F-run.png` là trạng thái cuối `needs_decision` đã giải thích.
