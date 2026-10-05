# H2c · Tiêu chí nghiệm thu (spec §8, qc)

Phụ lục của [`spec.md`](spec.md) §8 (tách ở readiness lần 1 — trần 25 600 B). Seam test đã chốt ở readiness (`readiness.md` lần 1, L1–L10): đồng hồ sweeper + tắt vòng nền (`sweepOnce`), hạn mức nhỏ qua `AppDeps`, driver dựng trực tiếp `createLocalStorage({dir})`.

| AC | Given / When / Then | Test |
|---|---|---|
| AC-H03 | Vế đính kèm: `lan` tải `hoadon.pdf`, gửi "kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai" + id; Orchestrator thấy `hoadon.pdf` trong `<attachments>`, delegate `hoadon` (job mang file) → `trello` → `answer`. Chuỗi nhiều bước do Runtime kịch bản quyết định (int); stack: một delegate `hoadon` + `#fake:files` đúng sha256 (L5) | acceptance + stack |
| HUB-H2c-AC-01 | PDF 1 MiB → 201; file ở `<dir>/<tenant>/<id>`, sha256 đúng; `/content` trả đúng byte + đủ header R13 | acceptance |
| HUB-H2c-AC-02 | Đúng 20 MiB → 201; 20 MiB + 1 (có `Content-Length`) → 413 trước khi đọc thân, 0 hàng, 0 file `.part`; **chunked** không `Content-Length` 20 MiB + 1 → 413 (bộ đếm); `Content-Length` giả nhỏ hơn thân (socket thô) → không lưu quá `Content-Length` byte, không `.part`, Hub vẫn phục vụ request kế (L3 — HTTP/1.1 không cho 413 ở vế này); thân rỗng / thiếu `X-Filename` → 400 | acceptance |
| HUB-H2c-AC-03 | 415: `.exe`; `MZ` đổi đuôi `.pdf`; `.pdf` chứa PNG; `.html`; `.svg`; `.txt` có NUL; `#!` đuôi `.md`. 201: `.docx`, `.csv` BOM, `.JPG` | acceptance |
| HUB-H2c-AC-04 | Tên: `../../etc/passwd.txt`, `a\b.txt`, `‮gnp.exe.txt` (U+202E), `CON.txt`, `.env.md`, tên 300 ký tự, tiếng Việt có dấu → đúng bảng plan; ổ Hub chỉ có uuid | unit + acceptance |
| HUB-H2c-AC-05 | Cách ly: user `beta` GET file của `acme` → 404; gửi tin với id `acme` → 404 `ATTACHMENT_NOT_FOUND` `details.ids`, 0 run/message; cùng tenant khác user → 404 | acceptance |
| HUB-H2c-AC-06 | Gắn: 2 id → `attachments` đúng thứ tự trong E11/E10/lịch sử; dùng lại id → 404; 2 POST song song cùng id → đúng 1 thành công, 1 × 404, file gắn đúng 1 message; 11 id / id trùng → 400; tin không file → không có khoá `attachments` | acceptance + int concurrency |
| HUB-H2c-AC-07 | Agent CLI: `@assistant #fake:files` + 2 file → đúng `name:sha256`; prompt có khối file; `#fake:read=../<job khác>/attachments/x` → deny; token job khác / id ngoài payload / job đã xong → 401; lệch tenant → 401 | acceptance + stack |
| HUB-H2c-AC-08 | Runtime: Hub trả sai sha256 / thiếu byte → job `failed` reason `attachment`, không còn file, `run.failed INTERNAL_ERROR`; `name` có `..` → payload sai hình ⇒ `failed invalid_payload`, 0 lần tải (contract cấm — F15); vế `bad_name` và "đích là symlink sẵn" kiểm bằng gọi thẳng `fetch_attachments` (L4; int: thư mục làm mới nên symlink đặt sẵn bị thay); lỗi 5xx 1 lần → thử lại thành công | Python int |
| HUB-H2c-AC-09 | Command sync `/hoadon` (input `file` bắt buộc map `attachment`): mock Dify nhận `/files/upload` (`user=<tenant>:<user>`, tên `safe_name`) rồi `inputs` có `upload_file_id`; không file → 422 `CMD_MISSING_ARG` `missing`; map `attachment` vào input `text` → `invalid`; Dify upload 415 → `run.failed UPSTREAM_ERROR` hint R22 | acceptance |
| HUB-H2c-AC-10 | Command async: job `workflow.async` có object file trong `inputs`, Runtime gửi nguyên; mock không nhận `/files/upload` từ Runtime | acceptance + stack |
| HUB-H2c-AC-11 | Tool MCP: job có file → `tools/list` có workflow input `file`; `tools/call` với `name` → 1 upload + 1 lời gọi; tên ngoài job → `isError`, 0 lời gọi; job không file → workflow vắng | acceptance |
| HUB-H2c-AC-12 | `out/` (Q3 = A): `#fake:out=report.md` → tin assistant `attachments=[report.md]`, `/content` đúng; symlink trong `out/` bị bỏ; 6 file → 5; `.exe` (đuôi) và `bad.pdf` nội dung chữ (chữ ký, L7) trong `out/` → bỏ, job vẫn `done`; run huỷ → output không gắn. Tool `Write` (R24): agent bật `Write` ghi được `out/<tên>`; ghi `attachments/`, gốc `work/<job_id>/`, `out/<thư mục con>/`, ngoài job → deny; agent không bật → `tool_not_allowed`; `OUT_HINT` chỉ ở job có `Write` | acceptance + Python int |
| HUB-H2c-AC-13 | Vòng đời (đồng hồ tiêm qua `sweepOnce`, vòng nền tắt — L1): chưa gắn 24 h + 1 s → mất file + hàng; xoá hội thoại → sau 1 chu kỳ nội dung mất, `purged_at`, `/content` 404 (`available=false` quan sát ở hội thoại còn bằng `purged_at` đặt qua SQL — L9); file `.part` mồ côi > 1 h → xoá | int |
| HUB-H2c-AC-14 | Hạn mức: ngưỡng 1 MiB (truyền qua `AppDeps`, env luôn ≥ 20 MiB — L2), 3 upload 400 KiB song song → đúng 2 thành công, 1 × 409 | int |
| HUB-H2c-AC-15 | Khởi động: `HUB_ATTACH_DRIVER=s3` / `HUB_ATTACH_DIR` tương đối / không ghi được → hub-api không lên; key giả `../x` → Storage từ chối | unit + int |
| HUB-H2c-AC-16 | Hồi quy: `test:contract:chat` 41 ca xanh; test khoá H1/H2a/H2b xanh nguyên văn; `contracts:check` xanh | contract + CI |
| HUB-H2c-AC-17 | Smoke `HUB_LIVE=1` (không chặn): `claude-sub` đọc PDF 2 trang và ảnh PNG đính kèm, trả đúng nội dung; agent bật `Write` trả `out/report.md` | smoke |

Lệnh xong mốc: `done:h2c` (qc, `test-plan.md`, mẫu `done:h2b`). Hiệu năng Python 10 × 2 MiB (spec §6) chỉ báo cáo, không chặn (L10).
