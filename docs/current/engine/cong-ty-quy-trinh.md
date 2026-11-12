# Engine · Quy trình của công ty (sao chép, chỉ xem, lọc lượt chạy)

> **CR-127 (2026-11-11) — phần Thư viện/khe/sao chép/mẫu/máy duyệt cũ trong file này ĐÃ THAY THẾ:** xem [engine/quy-trinh-cr127.md](quy-trinh-cr127.md). Giữ làm lịch sử; chỗ mâu thuẫn thì file CR-127 thắng.

Cập nhật: 2026-11-09 · Nguồn: cr121-c9-runs-clone-api (CR-121). Chạy bản riêng: `cong-ty-quy-trinh-ban-rieng.md`. Code: `apps/hub-api/src/modules/processes/library/clone-for-company*`, `processes/runs/`.

#### Yêu cầu: Sao chép quy trình thư viện cho công ty (nguồn: cr121-c9-runs-clone-api)
Quản trị công ty (hoặc quản trị nền tảng) sao một quy trình thư viện đã xuất bản thành bản riêng của công ty và tự đặt bản riêng thay bản nguồn trong các luật chọn quy trình đang trỏ đúng nguồn; luật trỏ quy trình khác giữ nguyên; công ty chưa có luật và nguồn là mặc định của việc ⇒ bản riêng thành luật mặc định. Có audit.
Lần đầu 201 `created:true`; lần hai (kể cả hai POST đồng thời) 200 `created:false`, cùng `def_id`, không ghi thêm. member 403; quản trị công ty khác 404; mẫu không khe 422 `NOT_LIBRARY_DEF`; khe mất 422 `SLOT_GONE`; chưa xuất bản 422.

#### Yêu cầu: Đọc chỉ xem quy trình thư viện theo công ty (nguồn: cr121-c9-runs-clone-api)
Quản trị công ty đọc quy trình thư viện ở bản xuất bản hiện hành cùng lượt chạy của chính công ty mình, `read_only:true`; bản riêng đã sao hiện ở `company_copy`. Công ty lạ 404, member 403.

#### Yêu cầu: Lượt chạy lọc theo việc và quy trình (nguồn: cr121-c9-runs-clone-api)
Danh sách lượt chạy lọc theo việc (`slot`, gồm quy trình thư viện và bản riêng của chính công ty) hoặc theo `def_id` (giao nhau với `slot`); `slot` sai định dạng ⇒ 400; chỉ trong công ty người gọi.
