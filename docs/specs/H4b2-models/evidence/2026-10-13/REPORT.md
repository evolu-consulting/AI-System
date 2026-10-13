# UAT H4b-2 Models + Quyền agent — tenant evolu — 2026-10-13

**Kết luận: Đạt** — 0 Blocker, 0 Major, 7 Minor. Trình duyệt thật + Hub thật (không route giả lập), VI, desktop 1280×800.
Tài khoản: `admin` (platform), `julian.bui` (tenant_admin evolu), `thomas.tran` (member evolu). Ảnh/script/`result.json` cùng thư mục.

## Kịch bản
| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Providers: danh sách, chi tiết, tạo `fake` (dev), khoá trùng, sửa, bật/tắt, xoá có xác nhận; `PROVIDER_IN_USE` (badge profile), `PROVIDER_HAS_HISTORY`, `dify` readonly | Đạt |
| 2 | Kiểm tra key: `fake-ok…` hợp lệ, key sai `HTTP 401`; `fake-cli` (Runtime thật) hợp lệ; subscription không Worker ⇒ "Đã yêu cầu kiểm tra…" ~10 s; Runbook (Sao chép, Kiểm tra lại) | Đạt |
| 3 | Profiles: Lên/Xuống lưu đúng (API + tải lại), `PROFILE_IN_USE`, xoá profile rảnh | Đạt |
| 4 | Access: bật/tắt grant, hộp thu hồi đếm grant, `AGENT_IS_DEFAULT` (switch hoàn về), drawer chi tiết | Đạt (ô "—" chỉ-một-tenant không có dữ liệu để kiểm) |
| 5 | Không phải platform_admin: 403 ở API đọc/ghi; Studio → `/studio/forbidden`, vào thẳng `/studio/models`, `/studio/access` cũng bị chặn | Đạt |
| 6 | Dispatch dự phòng: profile `uat-fb` bước 0 tắt ⇒ job chạy `fake-cli` model `m2`, log `job.fallback {skipped:[{index:0,why:"disabled"}], to:"fake-cli"}`; agent có model riêng ⇒ không chuyển bước, `ALL_PROVIDERS_EXHAUSTED` | Đạt |

## Lỗi (Minor)
1. `dify` (readonly) vẫn hiện Sửa/Xoá; chỉ báo lỗi sau khi xác nhận xoá (`prov/19-A-dify-delete-result.png`).
2. Provider API chưa có state hiện "Chưa có Worker kiểm" — câu chỉ đúng cho subscription.
3. Lệch mockup Provider-Sheet: link "Tạo secret" dưới ô (mockup cùng hàng nhãn); Base URL thiếu placeholder "để trống = mặc định của hãng"; Loại là chữ trơn (mockup badge); sheet subscription thiếu ghi chú link "Hướng dẫn đăng nhập".
4. Lệch mockup Runbook: chip cam thay banner đỏ; bước 3 thiếu "Kết quả hiện như hộp Kết quả kiểm tra".
5. Hai ô lọc ma trận Quyền agent không có nhãn nhìn thấy.
6. (Ghi nhận) `PUT /agents` chuẩn hoá `runtime_options` `{}` → mặc định và tăng version — hành vi có sẵn từ H4a, không phải lỗi H4b-2.
7. (Chấp nhận) vendor `fake` hiện `0 ms`.

## Giới hạn
- Không kiểm EN, dark/light, mobile. Nhánh HTTP anthropic/openai/google, `timeout`, `unsupported` chỉ có test int.
- Dùng SQL cho: job lịch sử (`HAS_HISTORY`), `logged_out` của provider thử; `result.json` dispatch viết tay.
- Dự phòng chỉ kiểm trigger "tắt"; `quota`/`error` lúc chạy thật chưa kiểm.

## Dọn dữ liệu
Đã xoá mọi dữ liệu `uat-`. Còn: 2 hội thoại chat của `thomas.tran`, 1 job thành công `pb-doc-fake`, 1 entitlement đã thu hồi `ba-analyst` × evolu. Script: `scripts/cleanup.mjs`.
Ghi chú seed có sẵn (không thuộc H4b-2): bỏ agent `dify-tom`, `dify-tro-ly` vì workflow `tom`, `tro-ly` không có trong `admin.workflows`.
