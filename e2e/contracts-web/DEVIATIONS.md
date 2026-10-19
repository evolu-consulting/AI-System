# Lệch có chủ ý so với mgmt-app (D-02, D-21)

Chỉ những lệch đã chốt; mọi lệch khác là lỗi và nằm ở `docs/specs/N1-pack-frame/tasks.md` mục "Lệch giao diện".

| Màn | Lệch | Cách xử lý ở harness |
|---|---|---|
| S01 đăng nhập | Ô "Mã công ty" (D-21: contracts-web đăng nhập admin-api theo tenant); mgmt-app không có | `HIDE` trong `scenes.cw.ts` ẩn `label:has(input[name=tenant_key])` ở cả hai phía |
| S02 onboarding | Bỏ (Q-F3) | Không có cảnh |
| Shell | Panel phải: nội dung trợ lý khác (slot lazy, HD6) | `localStorage assistant:open=0` ở cả hai phía; vùng `main` bị che (mask) vì nội dung màn thuộc lát sau |
| S05 kiểm/sửa HĐ | HD3: `Xác nhận` đã có (so thật — quyết cấp 1 trên engine, lưu ô đã đổi trước như mgmt-app). Thêm `Duyệt` (cấp 2), `Từ chối` (hộp lý do), `Đọc lại`, dòng trạng thái duyệt — mgmt-app chỉ một bước `confirm` ⇒ ẩn `[data-approval]` ở cả hai phía. `Ghi việc` (HD7) và điền sẵn của trợ lý (HD6) chưa có (D2-05). `Xem file gốc` trỏ `/pack/contracts/contracts/:id/file` (Bearer, TECH-DEBT #220 — đã sửa vòng review: bấm ⇒ `GET …/file-link` có Bearer rồi mở tab) | `HIDE` ẩn `[data-approval]`; giả `GET …/approval` = cấp 1 `can_act` (HĐ đọc lỗi: chưa có run); dữ liệu ở trạng thái `needs_review` nên `Ghi việc` mgmt-app không hiện |
| S04 nhập tay | Không có điền sẵn của trợ lý (HD6) | Không ảnh hưởng: không có dữ liệu điền sẵn |
| S10 `/cks` (HD9) | Bảng khách phân trang + tìm ở server (HD9-AC09, D9-22) thay vì tải hết; giao diện, nhãn, Pager giữ nguyên. Điền sẵn từ trợ lý `?sell_to=` (HD6) chưa có | Không ảnh hưởng ảnh: dữ liệu 3 khách, một trang |
| S08 `/prices` (HD9) | Ô "Mặt hàng" chỉ có "Chữ ký số" (hàng hoá = HD8); "Kiểm tra thị trường" mở panel báo lát HD8 (S09); "Dò giá" ⇒ 503 `AGENT_UNAVAILABLE` (D9-10, D9-13) | Cảnh chụp trạng thái panel đóng, chưa có lượt dò ⇒ không ảnh hưởng |
| S11 `/cks/$id` (HD9) | "🔔 Hẹn nhắc" / nhắc hoàn tất gia hạn: HD9 ghi lịch `cks_followups`, gửi đúng giờ ở HD4 (D9-09); "đã thanh toán" chờ HD7 (D9-08) | Không ảnh hưởng ảnh |
| W1 /my-work «Việc của tôi» | mgmt-app không có màn riêng (việc nằm ở thẻ đầu khoang trợ lý) — màn thiết kế mới theo khung contracts-web | Không có cảnh so ảnh; hành vi ở mywork.cw.ts |
| W1 /sourcing «Mua hàng» | Gốc ở cm-web (Next), không phải web Vite mgmt-app dùng làm baseline; thêm tìm + phân trang | Không có cảnh so ảnh; hành vi ở sourcing.cw.ts |
| W1 menu | Hai mục thêm «Việc của tôi», «Mua hàng» (mgmt-app web có 4 mục) | data-w1-nav bị ẩn ở cả hai phía trong HIDE (cảnh shell) |
| Đăng nhập (nhãn) | Ô "Email" nhận tên đăng nhập admin-api | Cùng nhãn "Email" ⇒ không ảnh hưởng chữ |

Dữ liệu giả dùng chung: `dataset.ts` (`asMgmt()` cho mgmt-app, `asHub()` cho contracts-web). Baseline theo OS ở `baseline/<platform>/` (hiện `win32`; máy khác chụp lại bằng `bun run e2e:contracts:ref`).

HD5 (S03 danh sách + S05 phụ lục): màn S03 so thật (chữ/khung/ảnh) — dữ liệu `dataset-list.ts`. Khối `Phụ lục và giá` của S05 (gắn HĐ gốc, bảng giá áp phụ lục) không có trong mgmt-app web (phụ lục do backend gắn tự động) ⇒ gắn `data-hd5` và ẩn ở cả hai phía bằng `HIDE`; hành vi kiểm ở `hd5-list.cw.ts`. Nút xoá HĐ của owner chưa có (D-HD5-03).
