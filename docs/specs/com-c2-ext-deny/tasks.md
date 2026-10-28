# com-c2-ext-deny — Chặn user ngoài ở mọi bề mặt (CR-102a)

Đọc: `docs/current/community/nghiep-vu.md` §13, `hien-thi.md` HT-76, HT-78; ADR-0031 (port chỉ nội bộ).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C2 | **Đầy đủ** (quyền/auth; security review riêng) | Opus | — | C1 |

## Phạm vi
Từ chối mặc định `kind=external` ở: pack guard (chỉ gói trong `EXTERNAL_PACKS={community}`, bỏ qua Group) · `chat-gate` (không Chat App) · agent grants `subject_type='tenant'` (hub 0018) + agent mặc định/dự phòng · `/directory` (`directory.repo.ts`) · kit `members.route`/`member-names`/pickers · portal app-catalog + `default_app` · admin-web/admin-api (chỉ `/me`, đổi mật khẩu) · RLS `contracts` phòng thủ (`kind=external` ⇒ 0 hàng) · quota/usage tính tenant chủ quản (ghi nhận, không chặn). Không mở lại module đóng băng.

## Xong khi
**Một int mỗi bề mặt** (ma trận user ngoài × bề mặt ⇒ 403/0 hàng/không xuất hiện); user nội bộ không đổi (chạy int hiện có của các file chạm tới, không chạy cả bộ). `test:frozen` không cần.

## Quyết định trong lúc làm
<!-- agent điền -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §13 cuối đợt.
