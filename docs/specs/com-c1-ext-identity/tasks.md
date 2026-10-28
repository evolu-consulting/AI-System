# com-c1-ext-identity — User ngoài (CR-102a)

Đọc: `docs/current/community/nghiep-vu.md` §2–3, §13; `hien-thi.md`; CR-102a; intake mục Ảnh hưởng.
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C1 | **Đầy đủ** (auth/RLS toàn nền tảng; security review riêng) | Opus | admin **0028** | C0 |

## Phạm vi
`admin.external_orgs` (công ty đối tác: tên, mã, trạng thái) + `admin.users.kind ∈ internal|external` (mặc định `internal`) + `external_org_id`; ràng buộc: `kind=external` ⇔ có `external_org_id`, `role=member`. `AuthUser`/`PackWho` mang `kind`, `extOrgId`. MỘT port `ExternalOrgResolver` cho mọi tra "user thuộc công ty đối tác nào". ai-admin màn "Đối tác": tạo công ty + user (tên đăng nhập, mật khẩu tạm, `must_change_password`), đặt lại mật khẩu tạm, khoá/vô hiệu (không xoá cứng). Nhãn NCC/mua, nhóm hàng, liên kết đối tác SHT **không** ở đây (C3). Không chặn bề mặt khác (C2).

## Xong khi
Unit (ràng buộc kind/org, sinh mật khẩu tạm); int: tạo công ty+user, đăng nhập đổi mật khẩu lần đầu, khoá; một test chặn đọc chéo tenant cho `external_orgs`. Seed dev: không tạo công ty đối tác ở lát này (C12 làm trên tenant `demo`). Không chạy e2e (viết file ADM màn Đối tác được).

## Quyết định trong lúc làm
<!-- agent điền -->

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §2–3 cuối đợt.
