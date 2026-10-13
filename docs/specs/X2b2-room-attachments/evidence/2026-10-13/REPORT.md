# UAT X2b-2 — 2026-10-13

qc-uat (Chromium headless). Kết luận: **6/7 kịch bản Đạt, 1 Chặn (kịch bản 5, do dữ liệu seed/môi trường). Không có lỗi sản phẩm.**

## Stack
- `bun run hub:dev` (`HUB_PROCESS_ENGINE=on`, attach local) + chat-web :3100.
- Tenant `evolu`: A = `julian.bui`, B = `thomas.tran`, C = `vio.ngo`. Agent `pb-doc-fake`.
- `invoices`/`consultant` dùng `claude-sub-1` lỗi `ALL_PROVIDERS_EXHAUSTED` trong dev fake-cli (môi trường, không phải lỗi sản phẩm).
- Ghi chú seed `hub:dev`: bỏ `dify-tom`, `dify-tro-ly`, `hoa-don-doc → ghi-so`.

## Kịch bản
| # | Nội dung | Kết quả | Ảnh |
|---|---|---|---|
| 1 | DM: chip, note, needText, lỗi `.exe` và 20 MB + 1 | Đạt | `01-A-dm-chip-note-needtext`, `02-A-dm-sent`, `02-B-dm-received-chip`, `03-A-dm-errors` |
| 2 | Nhóm; C (ngoài nhóm) 404 qua API; header `nosniff`/`no-store` | Đạt | `04-A-group-note`, `05-B-group-chip`, `result.json` |
| 3 | Thread | Đạt | `10-A-thread-chip-note`, `11-A-thread-sent`, `12-B-thread-view` |
| 4 | Agent nhận file tin gọi + tin trước; `out/` hiện chip; B tải được | Đạt | `07-A-agent-sent`, `08-A-agent-reply-out`, `09-B-agent-reply-out` |
| 5 | `side_effect` + `out/` | **Chặn** | — |
| 6 | `!hoa-don` kèm file ⇒ `noAttach` | Đạt | `13-A-bang-noattach` |
| 7 | B rời nhóm ⇒ 404; A vẫn 200 | Đạt | `14-B-room-options`, `15-B-after-leave` |

Kịch bản 5 chặn: seed thiếu workflow `ghi-so` và fake-cli không phát `side_effect`. Phủ bằng int I55–I58 (`tests/acceptance/X2b2/withheld.int.test.ts`).

## Giới hạn
Chưa kiểm dark mode/mobile; chưa rớt SSE thật (AC14); chưa xoá phòng/sweeper (AC11, có int). Dữ liệu `x2b2-uat-*` còn trong DB dev.
