# INDEX — bản đồ tài liệu

Đọc file này trước, rồi mở **đúng một** thứ cần. Không đọc cả `docs/design/` khi chỉ cần một feature.

## Luật & quy trình
| File | Dùng khi |
|---|---|
| `../CLAUDE.md` | Luật làm việc (nạp mỗi phiên) |
| `WORKFLOW.md` | Vòng một mốc, đội agent, Gate, khoá test |
| `CONVENTIONS.md` | Chuẩn code, cấu trúc, giới hạn, format |
| `ROADMAP.md` | Mốc M0–M5, FR thuộc mốc nào |
| `STATE.md` | Đang làm gì, việc kế tiếp (tự chèn đầu phiên bằng hook) |
| `CHANGE-REQUESTS.md` | Nhật ký thay đổi yêu cầu `CR-xxx` |

## Thiết kế (nguồn chân lý nghiệp vụ, v0.4) — `design/`
| Phạm vi | BA | UI/UX |
|---|---|---|
| Tổng thể | `design/architecture.md` | — |
| Admin (`ADM-*`) | `design/admin/ba-admin.md` | `design/admin/ui-admin.md` (wireframe trong `.html`) |
| Agent Hub (`HUB-*`) | `design/agent-hub/ba-agent-hub.md` | `design/agent-hub/ui-agent-studio.md`, `design/agent-hub/ui-operations.md` |
| Worker (`WRK-*`) | `design/worker/ba-worker.md` | — |
| Chat & Extension | — | `design/chat-app/ui-chat-extension.md` |
| Design đã duyệt (Gate M0) | Canvas: https://claude.ai/artifact/FTSiKuF9ax5DkMBVKMdHDB · bản sao nguồn `design/canvas/` | 18 artboard Admin · token `design/canvas/tokens-map.md` |

Bản `.html` trong `design/` hiện viết tay; sẽ sinh từ md (xem `TECH-DEBT.md`).

## Kiến trúc & quyết định
| File | Nội dung |
|---|---|
| `adr/` | Architecture Decision Records (`0001-stack.md`…) |
| `PRODUCTION-NOTES.md` | Quyết định nhỏ, "đã thử & bỏ vì…", bẫy |
| `TECH-DEBT.md` | Nợ kỹ thuật ghi lại thay vì sửa lan |

## Code & truy vết
| File | Nội dung |
|---|---|
| `CODEMAP.md` | Module → file chính, hàm vào (chưa có code) |
| `TRACE.md` | FR → spec → code → test (sinh bằng `bun run trace`) |
| `specs/<ID>/` | spec.md · plan.md · tasks.md · test-plan.md · readiness.md |
| `specs/_template/` | Mẫu cho spec mới |
| `readiness/` | Báo cáo spec-readiness trước khi có spec (vd `2026-10-01-admin-m1-m4.md`) |

## Specs
| ID | Tên | Mốc | Trạng thái |
|---|---|---|---|
| — | (chưa tạo) | | |
