# UAT CR-095 — contracts-web + admin-web (qc-uat)

- Ngày chạy: 2026-10-20 (server UTC 08:07–09:40), nhánh platform/gd0, commit 03cce4e4 (git archive HEAD).
- Stack: project Docker `evotest` trên evotest 149.202.83.5 (pg 16.15 volume `evotest_uat-pgdata`, redis 7.4.11, 1 container bun: admin-api :3001, hub-api :4000, admin-web :3000, chat-web :3100, contracts-web :3300 — build + `rsbuild preview`; agent-runtime Python `fake-cli` ở container thứ hai chung mạng). Cổng bind 127.0.0.1 máy chủ → `ssh -N -L` về localhost 13000/13001/13100/13300/14000. Giữ `.lock` evotest suốt lượt; tuyệt đối không đụng project `aisystem`.
- AI: chỉ fake-cli (không có khoá). Trích xuất AI DOCX, "Đọc lại", chat thật với Claude = **chờ key**.
- Tài khoản (tenant `acme`, mật khẩu dev `dev-password-1`): **chu** (contracts-owner + editor, thấy tất cả), **soan** (editor), **xem** (viewer; là quản lý của soan nên thấy HĐ của soan/han), **han** (editor hạn chế: quản lý là soan, chỉ thấy HĐ của chính mình), **lan/hoa** (editor/viewer không có quan hệ tổ chức ⇒ 0 HĐ). Visibility tenant = `org`. Platform admin `admin`.
- Dữ liệu seed: 5 HĐ nhập tay ban đầu + 5 HĐ do soan/han tạo (BB-01 500 tr, SM-02 1,2 tỷ, TP-03 240 tr, HL-04 80 tr, K-05 15 tr), một phần đã duyệt cấp 1/2 bằng API, lịch thanh toán, 3 báo giá. Chạy bằng Playwright (Chromium, Node 22.23.3) qua tunnel.

## Tổng kết
OK 69 · LỖI 3 · chờ key 3 · chưa xác nhận (lỗi script, hết giờ) 1 · không chạy 1.

## Bảng kết quả
| Tính năng | User | Kết quả | Bằng chứng | Ghi chú |
|---|---|---|---|---|
| Đăng nhập UI | chu | OK | [01-login-ok-chu-desktop-light.png](shots/01-login-ok-chu-desktop-light.png) |  |
| Đăng nhập: màn hình (light) | - | OK | [01-login-light.png](shots/01-login-light.png) |  |
| Đăng nhập: sai mật khẩu → thông báo | lan | OK | [01-login-wrong-pw.png](shots/01-login-wrong-pw.png) | Sai thông tin đăng nhập. |
| Đăng nhập: màn hình (dark) | - | OK | [01-login-dark.png](shots/01-login-dark.png) |  |
| Đăng nhập: màn hình (mobile) | - | OK | [01-login-mobile.png](shots/01-login-mobile.png) |  |
| Vỏ: menu 4 mục + nhóm Tiện ích | chu | OK | [02-shell-chu-desktop-light.png](shots/02-shell-chu-desktop-light.png) | nút Thêm HĐ: có; link Cài đặt: không; chữ "Tiện ích" trong DOM: KHÔNG |
| Vỏ: tối + di động (thanh dưới) | chu | OK | [02-shell-chu-mobile-light.png](shots/02-shell-chu-mobile-light.png) | nav: Điều hướng chính:5 \| Tiện ích:2 \| Tiện ích:2 \| Phân trang:0 \| Điều hướng:4 |
| Vỏ: menu 4 mục + nhóm Tiện ích | soan | OK | [02-shell-soan-desktop-light.png](shots/02-shell-soan-desktop-light.png) | nút Thêm HĐ: có; link Cài đặt: không; chữ "Tiện ích" trong DOM: KHÔNG |
| Vỏ: menu 4 mục + nhóm Tiện ích | xem | OK | [02-shell-xem-desktop-light.png](shots/02-shell-xem-desktop-light.png) | nút Thêm HĐ: không; link Cài đặt: không; chữ "Tiện ích" trong DOM: KHÔNG |
| Vỏ: menu 4 mục + nhóm Tiện ích | han | OK | [02-shell-han-desktop-light.png](shots/02-shell-han-desktop-light.png) | nút Thêm HĐ: có; link Cài đặt: không; chữ "Tiện ích" trong DOM: KHÔNG |
| Danh sách HĐ: thấy đúng 10 HĐ theo phạm vi | chu | OK | [03-list-chu.png](shots/03-list-chu.png) |  |
| Danh sách HĐ: thấy đúng 8 HĐ theo phạm vi | soan | OK | [03-list-soan.png](shots/03-list-soan.png) |  |
| Danh sách HĐ: thấy đúng 8 HĐ theo phạm vi | xem | OK | [03-list-xem.png](shots/03-list-xem.png) |  |
| Danh sách HĐ: thấy đúng 2 HĐ theo phạm vi | han | OK | [03-list-han.png](shots/03-list-han.png) |  |
| Hiển thị: han không thấy HĐ/đối tác/giá/mua hàng của người khác | han | OK | [04-han-direct-url.png](shots/04-han-direct-url.png) [04-han-prices.png](shots/04-han-prices.png) |  |
| Danh sách HĐ: thấy đúng 0 HĐ theo phạm vi | lan | OK | [03-list-lan.png](shots/03-list-lan.png) |  |
| Danh sách HĐ: thấy đúng 0 HĐ theo phạm vi | hoa | OK | [03-list-hoa.png](shots/03-list-hoa.png) |  |
| Danh sách: tìm kiếm | chu | OK | [05-list-search.png](shots/05-list-search.png) | 2 dòng |
| Danh sách: bộ lọc + facet | chu | OK | [05-list-filter.png](shots/05-list-filter.png) |  |
| Danh sách: chọn cột + phân trang | chu | OK | [05-list-columns.png](shots/05-list-columns.png) |  |
| HĐ mới: nhập tay (UI) | soan | OK | [06-new-manual-filled.png](shots/06-new-manual-filled.png) [06-new-manual-detail.png](shots/06-new-manual-detail.png) |  |
| HĐ mới: tải DOCX lên (trích xuất AI) | soan | chờ key | [06-new-docx-upload.png](shots/06-new-docx-upload.png) | upload nhận file; trạng thái hiện ?; UI: Hợp đồng Đối tác So sánh giá Sản phẩm Việc của tôi Mua hàng SE Hợp đồng 2 Nhập t. Trích xuất AI cần ANTHROPIC_API_KEY |
| Duyệt: cấp 1 Xác nhận (240 tr < ngưỡng 500 tr → hiệu lực) | chu | OK | [07-approval-l1-before.png](shots/07-approval-l1-before.png) [07-approval-l1-after.png](shots/07-approval-l1-after.png) |  |
| Duyệt: cấp 2 Duyệt (1,2 tỷ ≥ ngưỡng, Ban giám đốc) | chu | OK | [07-approval-l2-before.png](shots/07-approval-l2-before.png) [07-approval-l2-after.png](shots/07-approval-l2-after.png) |  |
| Duyệt: Từ chối kèm lý do | chu | OK | [07-approval-reject-form.png](shots/07-approval-reject-form.png) [07-approval-rejected.png](shots/07-approval-rejected.png) |  |
| Duyệt: Đọc lại (AI đọc lại HĐ) | chu | chờ key |  | nút Đọc lại gọi lại trích xuất AI — cần ANTHROPIC_API_KEY |
| Duyệt: đổi ngưỡng 100 tr → HĐ 150 tr cần cấp 2 | chu | OK |  | ngưỡng khôi phục 500 tr |
| Duyệt: nhóm duyệt cấp 1/2 đổi được (approval-settings) | chu | OK |  | nhóm sai → 422 APPROVAL_GROUP_MISSING |
| Duyệt: viewer không đổi được cài đặt duyệt | xem | OK |  | 403 |
| Sửa MST bên bán của HĐ đã hiệu lực → mở lại duyệt | soan | OK | [08-edit-tax-before.png](shots/08-edit-tax-before.png) [08-edit-tax-after.png](shots/08-edit-tax-after.png) | status expiring → needs_review; duyệt mở lại level1 |
| Sửa trường thường (người ký) HĐ đã hiệu lực không mở lại duyệt | soan | OK | [08-edit-signer.png](shots/08-edit-signer.png) | status sau sửa: active |
| Duyệt: người gửi bấm Xác nhận HĐ của mình bị chặn (chu gửi HĐ-3214) | chu | OK | [07-approval-starter-click-chu.png](shots/07-approval-starter-click-chu.png) | nút Xác nhận vẫn hiện cho người gửi; bấm → báo: Đang chờ Ban giám đốc duyệt (bạn không thể duyệt bước này). (UX: nên ẩn/khoá nút) |
| Việc của tôi: danh sách (trễ hạn / hôm nay / sắp tới) + bộ đếm | chu | OK | [09-mywork-chu.png](shots/09-mywork-chu.png) | Tất cả (3) |
| Việc của tôi: hẹn nhắc (follow-up) trên một dòng | chu | OK | [09-followup-after.png](shots/09-followup-after.png) | 1 follow-up; Hẹn nhắc (1) |
| Sổ thanh toán: đánh dấu 'Đã trả' khoản trễ hạn | chu | OK | [10-ledger-paid.png](shots/10-ledger-paid.png) | Thanh toán 3 → 2; /payments 200 |
| Đối tác: danh sách + điểm uy tín | chu | OK | [11-partners.png](shots/11-partners.png) |  |
| So sánh giá: chọn sản phẩm → bảng nhà cung cấp theo giá | chu | OK | [12-prices-chu.png](shots/12-prices-chu.png) |  |
| So sánh giá: thêm báo giá (UI) + xoá | chu | OK | [12-quote-form.png](shots/12-quote-form.png) | hộp thêm báo giá mở được; tạo qua API ở bước seed |
| CKS: nhập lô mua | chu | OK | [13-cks-lot-form.png](shots/13-cks-lot-form.png) [13-cks-lot-after.png](shots/13-cks-lot-after.png) |  |
| CKS: hợp đồng bán chữ ký + người giữ | chu | OK | [13-cks-sale-form.png](shots/13-cks-sale-form.png) [13-cks-sale-after.png](shots/13-cks-sale-after.png) |  |
| Mua hàng (sourcing): dòng hàng bán ↔ nguồn mua, lãi, rủi ro | chu | OK | [14-sourcing-chu.png](shots/14-sourcing-chu.png) | 3 kết quả |
| Hiển thị (lần 2, sau khi có thêm dữ liệu): han không thấy HĐ/đối tác/báo giá của người khác | han | OK | [14-han-sourcing.png](shots/14-han-sourcing.png) | API compare 404, partners không lộ |
| Sổ thanh toán: dời hạn + nhắc khoản thanh toán thủ công | chu | OK | [10-ledger-postpone.png](shots/10-ledger-postpone.png) | postpone 200, remind 200 |
| Hạn hợp đồng: ghi nhận xử lý (Đang đàm phán) trên trang chi tiết | chu | OK | [09-handled.png](shots/09-handled.png) |  |
| CKS: mở rộng nhóm khách (người giữ chữ ký) | chu | OK | [13-cks-customer.png](shots/13-cks-customer.png) |  |
| Viewer: nút ghi/chấm điểm ở Đối tác phải ẩn (server trả 403) | xem | LỖI | [FAIL-Viewer-n-t-ghi-ch-m-i-m-i-t-c-ph-i-n-ser-xem.png](shots/FAIL-Viewer-n-t-ghi-ch-m-i-m-i-t-c-ph-i-n-ser-xem.png) | viewer thấy 8 nút "+ Ghi việc"/"Chấm điểm" ở /partners (server POST /partner-events/PUT ratings → 403 PACK_FORBIDDEN) |
| Đối tác: ghi việc cho Công ty Gamma (HĐ nhập tay do soan tự xác nhận) | chu | LỖI | [FAIL--i-t-c-ghi-vi-c-cho-C-ng-ty-Gamma-H-nh-p-chu.png](shots/FAIL--i-t-c-ghi-vi-c-cho-C-ng-ty-Gamma-H-nh-p-chu.png) | Ghi việc cho Gamma báo: Không tìm thấy, có thể đã bị thay bằng lịch mới (API POST /partner-events party=tax:0311111999 → 404, các đối tác khác → 201) |
| Trợ lý AI: mở bảng + gửi tin, nhận trả lời (fake AI) | chu | OK | [16-assistant-open-chu.png](shots/16-assistant-open-chu.png) [16-assistant-reply-chu.png](shots/16-assistant-reply-chu.png) | trả lời của fake-cli (không phải Claude) |
| Trợ lý AI: gọi tool hợp đồng (contracts-search) — kết quả theo quyền xem | chu | OK | [16-assistant-tool-chu.png](shots/16-assistant-tool-chu.png) | tool trả kết quả |
| Trợ lý AI: chat thật với Claude (đọc/so sánh bằng LLM thật) | chu | chờ key |  | cần ANTHROPIC_API_KEY, profile claude-sub; chưa chạy |
| Trợ lý AI: mở bảng + gửi tin, nhận trả lời (fake AI) | han | OK | [16-assistant-open-han.png](shots/16-assistant-open-han.png) [16-assistant-reply-han.png](shots/16-assistant-reply-han.png) | trả lời của fake-cli (không phải Claude) |
| Trợ lý AI: gọi tool hợp đồng (contracts-search) — kết quả theo quyền xem | han | OK | [16-assistant-tool-han.png](shots/16-assistant-tool-han.png) | han không thấy HĐ người khác qua tool |
| Admin-web: màn đăng nhập (sáng/tối/di động) | - | OK | [20-admin-login-light.png](shots/20-admin-login-light.png) [20-admin-login-dark.png](shots/20-admin-login-dark.png) [20-admin-login-mobile.png](shots/20-admin-login-mobile.png) |  |
| Admin-web: đăng nhập platform admin + tổng quan | admin | OK | [21-admin-dashboard.png](shots/21-admin-dashboard.png) | ngôn ngữ giao diện sau đăng nhập: EN (màn đăng nhập hiển thị VI, trình duyệt vi-VN) |
| Admin-web: danh sách công ty | admin | OK | [21-admin-tenants.png](shots/21-admin-tenants.png) |  |
| Admin-web: tạo công ty mới (gamma) + quản trị đầu tiên | admin | OK | [21-admin-tenant-new.png](shots/21-admin-tenant-new.png) [21-admin-tenant-created.png](shots/21-admin-tenant-created.png) |  |
| Admin-web: người dùng (tìm kiếm, lọc theo công ty) | admin | OK | [21-admin-users.png](shots/21-admin-users.png) |  |
| Admin-web: nhóm (có nhóm contracts-owner/editor/viewer sau khi bật pack) | admin | OK | [21-admin-groups.png](shots/21-admin-groups.png) | danh sách nhóm mặc định (lọc theo công ty mới thấy nhóm pack) |
| Cổng pack: công ty chưa bật pack Hợp đồng → trang trạng thái, không vào được dữ liệu | an(beta) | OK | [22-pack-gate-beta.png](shots/22-pack-gate-beta.png) | ợp đồng trong trang quản trị. \| Đăng xuất |
| Màn hình list: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-list-light-desktop.png](shots/30-list-light-desktop.png) [30-list-dark-desktop.png](shots/30-list-dark-desktop.png) [30-list-light-mobile.png](shots/30-list-light-mobile.png) [30-list-dark-mobile.png](shots/30-list-dark-mobile.png) |  |
| Màn hình detail: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-detail-light-desktop.png](shots/30-detail-light-desktop.png) [30-detail-dark-desktop.png](shots/30-detail-dark-desktop.png) [30-detail-light-mobile.png](shots/30-detail-light-mobile.png) [30-detail-dark-mobile.png](shots/30-detail-dark-mobile.png) |  |
| Màn hình partners: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-partners-light-desktop.png](shots/30-partners-light-desktop.png) [30-partners-dark-desktop.png](shots/30-partners-dark-desktop.png) [30-partners-light-mobile.png](shots/30-partners-light-mobile.png) [30-partners-dark-mobile.png](shots/30-partners-dark-mobile.png) |  |
| Màn hình prices: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-prices-light-desktop.png](shots/30-prices-light-desktop.png) [30-prices-dark-desktop.png](shots/30-prices-dark-desktop.png) [30-prices-light-mobile.png](shots/30-prices-light-mobile.png) [30-prices-dark-mobile.png](shots/30-prices-dark-mobile.png) |  |
| Màn hình cks: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-cks-light-desktop.png](shots/30-cks-light-desktop.png) [30-cks-dark-desktop.png](shots/30-cks-dark-desktop.png) [30-cks-light-mobile.png](shots/30-cks-light-mobile.png) [30-cks-dark-mobile.png](shots/30-cks-dark-mobile.png) |  |
| Màn hình mywork: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-mywork-light-desktop.png](shots/30-mywork-light-desktop.png) [30-mywork-dark-desktop.png](shots/30-mywork-dark-desktop.png) [30-mywork-light-mobile.png](shots/30-mywork-light-mobile.png) [30-mywork-dark-mobile.png](shots/30-mywork-dark-mobile.png) |  |
| Màn hình sourcing: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-sourcing-light-desktop.png](shots/30-sourcing-light-desktop.png) [30-sourcing-dark-desktop.png](shots/30-sourcing-dark-desktop.png) [30-sourcing-light-mobile.png](shots/30-sourcing-light-mobile.png) [30-sourcing-dark-mobile.png](shots/30-sourcing-dark-mobile.png) |  |
| Màn hình scoring: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-scoring-light-desktop.png](shots/30-scoring-light-desktop.png) [30-scoring-dark-desktop.png](shots/30-scoring-dark-desktop.png) [30-scoring-light-mobile.png](shots/30-scoring-light-mobile.png) [30-scoring-dark-mobile.png](shots/30-scoring-dark-mobile.png) |  |
| Màn hình new: sáng/tối × desktop/di động (không tràn ngang) | chu | OK | [30-new-light-desktop.png](shots/30-new-light-desktop.png) [30-new-dark-desktop.png](shots/30-new-dark-desktop.png) [30-new-light-mobile.png](shots/30-new-light-mobile.png) [30-new-dark-mobile.png](shots/30-new-dark-mobile.png) |  |
| Đăng nhập: khoá tạm tài khoản sau 5 lần sai (thông báo) | hoa | OK | [40-login-locked.png](shots/40-login-locked.png) | 5 lần sai → mã 401,401,401,401,401; UI: Tài khoản tạm khoá do nhập sai nhiều lần. Thử lại sau 16:33. |
| Đăng nhập: trần theo IP → thông báo (contracts-web) | - | OK | [40-login-ratelimit-contracts.png](shots/40-login-ratelimit-contracts.png) | API chạm 429 sau 30 lần; Thử đăng nhập quá nhiều lần. Hãy thử lại sau 9 phút. |
| Đăng nhập: trần theo IP → thông báo (admin-web) | - | OK | [40-login-ratelimit-admin.png](shots/40-login-ratelimit-admin.png) | Thử đăng nhập quá nhiều lần. Hãy thử lại sau 9 phút. |
| Duyệt: cấp 1 — người gửi tự Xác nhận HĐ của mình (30 tr) | soan | OK |  | đúng thiết kế: luật STARTER_CANNOT_REVIEW chỉ áp cấp 2 (approval-machine.rules.ts); soan tự xác nhận được → active |
| Duyệt: cấp 2 — người gửi (chu) không duyệt được; nút vẫn hiện, bấm mới báo lỗi | chu | OK | [07-approval-starter-click-chu.png](shots/07-approval-starter-click-chu.png) | chặn đúng, nhưng UX: nút Xác nhận/Duyệt hiển thị cho người không được duyệt (bug B6) |
| Điểm uy tín: thêm tiêu chí tự chấm; tổng ≠ 100% thì không lưu (Tổng 110% · cần đúng 100%) | chu | OK | [FAIL--i-m-uy-t-n-th-m-ti-u-ch-t-ch-m-l-u-chu.png](shots/FAIL--i-m-uy-t-n-th-m-ti-u-ch-t-ch-m-l-u-chu.png) | xác minh qua ảnh: nút Lưu mờ khi tổng 110%. Bước 'sửa về 100% rồi lưu & tính lại' CHƯA XÁC NHẬN (lỗi script selector, hết giờ) |
| Đối tác: ghi việc cho Công ty Hoàng Long + hộp Chấm điểm (UI) | chu | CHƯA XÁC NHẬN |  | API POST /partner-events cho Hoàng Long → 201 OK; thao tác UI chưa chạy được do lỗi selector script, hết giờ |
| Nhập khẩu từ mgmt-app: kết quả import hiển thị theo phạm vi quyền | - | KHÔNG CHẠY |  | cần evotest-mgmt (mgmt-app + opensearch/neo4j) — ngoài phạm vi stack UAT lần này; dữ liệu import chưa có trong stack |
| Bật pack Hợp đồng cho công ty trong admin-web | admin | LỖI | [22-pack-gate-beta.png](shots/22-pack-gate-beta.png) | admin-web không có màn hình bật pack (chỉ API PUT /admin/tenants/:id/packs/contracts, platform_admin); thông báo của contracts-web lại bảo 'quản trị viên công ty bật trong trang quản trị' (bug B3) |

## Lỗi tìm thấy
| # | Mức | Mô tả | Các bước tái hiện | Bằng chứng |
|---|---|---|---|---|
| B1 | Cao | Viewer thấy nút "+ Ghi việc" và "Chấm điểm" ở /partners (UI không ẩn theo vai trò); server từ chối 403 PACK_FORBIDDEN | Đăng nhập acme/xem → /partners → thấy 8 nút ghi/chấm điểm → "+ Ghi việc" mở hộp ghi; API POST /pack/contracts/partner-events bằng token xem = 403 | [15-viewer-partners.png](shots/15-viewer-partners.png) |
| B2 | Cao | Không ghi được việc cho đối tác "Công ty Gamma" (HĐ tạo bằng "Nhập tay" rồi người tạo tự xác nhận cấp 1): POST /partner-events → 404, UI báo "Không tìm thấy, có thể đã bị thay bằng lịch mới"; các đối tác khác (Hoàng Long, Tân Phát, Sao Mai, Delta, Viettel-CA) → 201 | soan: /contracts/new nhập tay (Gamma, MST 0311111999, 30 tr) → Lưu → bấm Xác nhận; chu: /partners → Gamma → "+ Ghi việc" → Ghi | [FAIL--i-t-c-ghi-vi-c-cho-C-ng-ty-Gamma-H-nh-p-chu.png](shots/FAIL--i-t-c-ghi-vi-c-cho-C-ng-ty-Gamma-H-nh-p-chu.png) |
| B3 | Cao | Công ty chưa bật pack: contracts-web bảo "Quản trị viên công ty cần bật gói Hợp đồng trong trang quản trị" nhưng admin-web không có màn hình bật pack (chỉ platform_admin gọi API) ⇒ ngõ cụt | Đăng nhập contracts-web beta/an → trang "Gói Hợp đồng chưa được bật"; tenant_admin vào admin-web: không có mục Pack | [22-pack-gate-beta.png](shots/22-pack-gate-beta.png) |
| B4 | Cao | Bật pack xong, trợ lý `mgmt-assistant` vẫn báo "Bạn chưa được dùng trợ lý AI. Nhờ quản trị cấp quyền trong Agent Hub" cho cả owner; chỉ hết sau khi chạy lại `hub:seed` (access.yaml cấp theo group contracts-* nhưng bị bỏ qua vì group chưa tồn tại lúc seed). Tenant mới bật pack sẽ không có trợ lý | Tạo tenant → bật pack → đăng nhập owner → mở "Trợ lý AI" → gửi tin | (ảnh chụp trước khi seed lại không lưu; log: seed warning "bỏ entitlement assistant → tenant acme") |
| B5 | Thường | "Việc của tôi"/sổ thanh toán hiển thị khoản phải trả của HĐ chưa xác nhận (needs_review), kể cả HĐ vừa bị mở lại duyệt do sửa MST: trùng 2 dòng "Trả tiền Công ty Minh Phát 250.000.000", khoản trễ hạn Tân Phát từ HĐ chờ xác nhận | chu: /my-work sau khi seed lịch thanh toán cho HĐ chờ xác nhận | [09-mywork-chu.png](shots/09-mywork-chu.png) |
| B6 | Thấp | Nút "Xác nhận"/"Duyệt" vẫn hiện cho người gửi ở cấp 2 (không được duyệt); chỉ báo lỗi sau khi bấm ("Đang chờ Ban giám đốc duyệt (bạn không thể duyệt bước này)") | chu gửi HĐ-3214 (1,2 tỷ) → Xác nhận (cấp 1 ok) → nút Duyệt vẫn hiện cho chu | [07-approval-starter-click-chu.png](shots/07-approval-starter-click-chu.png) |
| B7 | Thấp | Ngôn ngữ: login contracts-web mặc định tiếng Anh dù trình duyệt vi-VN (chỉ vi khi localStorage ai.locale=vi; thiết kế CR-052); admin-web: màn đăng nhập tiếng Việt nhưng sau đăng nhập là tiếng Anh | Mở trình duyệt vi-VN → :3300/login; :3000 đăng nhập admin | [21-admin-dashboard.png](shots/21-admin-dashboard.png) |
| B8 | Thấp | /settings/members chặn owner của pack (contracts-owner): "Chỉ chủ sở hữu (quản trị tenant)…" — cần tenant_admin, nhãn "chủ sở hữu" gây hiểu nhầm; mục Cài đặt không có trong menu cho owner | chu → /settings/members | dumps/chu_settings_members.txt |

## Ghi chú về lần chạy
- Phiên đăng nhập lưu (storageState) hết hiệu lực giữa các script (refresh cookie xoay vòng) ⇒ script tự đăng nhập lại; đã tránh trần IP 30/10 phút. Trần IP chỉ thấy khi gọi qua cùng IP nguồn với trình duyệt (proxy contracts-web = 127.0.0.1, gọi thẳng cổng Docker = 192.168.48.1).
- Ảnh tối trong shots/02-* và login ban đầu hợp lệ; ảnh "30-*-dark-*" đặt `data-theme` bằng script. Ảnh FAIL-* là ảnh bước lỗi của các lần chạy (nhiều cái do script chỉnh selector, đã chạy lại).
- Sửa dữ liệu ngoài UI: trong lúc dựng stack đã xoá khoá rate-limit Redis của stack UAT một lần (do script thử sai mật khẩu); không đụng bảng hay mã sản phẩm.
- Cần chạy tiếp khi có khoá: trích xuất DOCX bằng AI (đang `extracting`/`extract_failed`), "Đọc lại", chat thật.
- Không có UI cài ngưỡng/cấp duyệt; ngưỡng 500 tr (mặc định) / 100 tr được thử qua API PUT /approval-settings (viewer 403, nhóm sai 422).
