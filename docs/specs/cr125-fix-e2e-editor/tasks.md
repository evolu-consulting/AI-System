---
id: cr125-fix-e2e-editor
lát: cr125-fix-e2e-editor
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Đỏ cuối đợt ở e2e editor/canvas admin: phân loại từng ca bằng git log từ e232e5ef0, sửa phía sai. Kết quả: tất cả là test cũ, không có lỗi sản phẩm.

## Làm
| Ca | Loại | Nguyên nhân | Sửa |
|---|---|---|---|
| P-b2 04/05/09 (nút "Thêm bước vào bước n", kéo đổi bước) | test cũ | CR-122 C + CR-123 u13 (e4f0b30d1): sơ đồ bỏ hàng tiêu đề cột và nút +; kéo node chỉ đổi vị trí, bước đổi bằng panel / Alt+mũi tên / ô "Chạy ở bước"; nút "Thêm bước vào bước n" còn ở dạng Danh sách | 04: kéo ⇒ bước giữ nguyên, rồi "Chuyển sang bước trước"; kiểm "đủ 3" ở dạng Danh sách; 05/09 kiểm nút ở dạng Danh sách |
| P-b editor.pb 52/125 | test cũ | c3/g5 đổi "Giai đoạn n" thành "Bước n" (nút node, region, nhãn "Nguồn của bước", câu lỗi) | đổi nhãn theo khoá i18n hiện tại |
| P-c editor.pc 44, P-c2 editor.pc2 30 | test cũ | G1 + c3: câu lỗi "stage" thành "bước"; vẫn nói cách khắc phục (Chọn "Duyệt" ở mục Sau bước; Đã có ở bước "…"; Bước Áp phải đứng ngay sau bước tự sửa mã) | đổi chữ trong test |
| P-c2 sources.pc2 (5) | test cũ | CR-121 c10/c22 gỡ mục "Nguồn" khỏi sidebar có chủ đích (P-b/sources.pb.ts đã vào bằng URL); lối vào UI còn ở thẻ "Nguồn của quy trình" (editor) và hub Hệ thống | vào thẳng `/sources` |
| K1 notice.k1 50/73 | test cũ | hộp kết quả admin đặt tên "Kết quả bước {{stage}} · v{{n}}" | `name: /Kết quả bước/` |

Hai LỖI SẢN PHẨM thật lộ ra khi test chạy tiếp (cả hai sửa trong lát):
- `ViewModeToggle` thiếu `type="button"` trong form `process-form` ⇒ bấm Sơ đồ/Danh sách bước là LƯU quy trình (làm bẩn def, các test sau đỏ: P-b2 06/08/09). Sửa: `type="button"`.
- G3: toast lỗi ở lại tới khi đóng, nằm góc dưới phải đè nút Lưu ⇒ sửa lỗi xong không bấm Lưu lại được (P-b E-PB09). Sửa: `notifyError(msg, action, "top-center")` cho 3 toast lỗi lưu ở `use-def-save.ts`.
- K1 cr121-run.k1 dùng `platformLogin` của P-b (cổng 4605) trên stack P-b2 ⇒ ERR_CONNECTION_REFUSED (test cũ, đỏ cố định, không phải flake): đăng nhập qua ADMIN_URL của stack.

## Không làm / Chạm
`e2e/**` (7 file), `tests/.lock`, `ViewModeToggle.tsx`, `use-def-save.ts`, `web-kit/ui/toast.tsx` (tham số `position` tuỳ chọn cho `notifyError`).

## Test tối thiểu
evotest e2e: jobs "P-b2 P-b P-c P-c2" `-Dirty -Slots 4`, rồi "K1".

## Quyết định trong lúc làm
- Không khôi phục nút "Thêm bước vào bước n" trên sơ đồ: đã bỏ có chủ đích (u13); người dùng vẫn làm được cùng việc qua menu "Thêm bước", panel, ô "Chạy ở bước", dạng Danh sách.
- Không khôi phục mục "Nguồn" ở sidebar: gỡ có chủ đích (c10 sidebar phẳng); lối vào còn ở trình sửa quy trình và hub Hệ thống.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/company-flows.md
#### Yêu cầu: Trình sửa quy trình — đổi cách xem và toast lỗi không cản nút Lưu
Bấm "Sơ đồ" / "Danh sách bước" chỉ đổi cách xem, không lưu quy trình (nút công tắc không còn là nút gửi form). Toast lỗi của Lưu (bị chặn trước khi gửi hoặc Hub từ chối) ở lại tới khi đóng nhưng hiện giữa-trên, không đè nút Lưu.
- Kịch bản: khi người dùng chuyển sang Danh sách bước thì không có PUT /process-defs và bản đã lưu không đổi [test: e2e/P-b2/admin/canvas.pb2.ts » ADM-FR-71 · E-PB2-09 · nút panel 'Chuyển sang bước sau' / 'Chuyển sang bước trước' / 'Lên' (đường a11y thay kéo thả)]
- Kịch bản: khi Lưu bị chặn vì lỗi nhập (đường dẫn sai, quá 10 mục) thì người dùng sửa xong vẫn bấm Lưu lại được [test: e2e/P-b/admin/editor.pb.ts » ADM-FR-69 · HUB-FR-121 · PB-R06 · PB-R14 · E-PB09 · chặn: bước >5 nguồn (ô thứ 6 disabled), nguồn ngoài quy trình (không có ô), glob "../x", >10 mục must_know, bỏ nguồn đang được bước dùng]

## Việc còn lại
Không.
