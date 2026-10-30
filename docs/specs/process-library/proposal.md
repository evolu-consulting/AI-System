---
id: process-library
cr: CR-105
trạng thái: đã duyệt 2026-10-31
ngày: 2026-10-31
---
# Đề xuất: Thư viện quy trình + gán theo tenant cho từng app — một chỗ sửa duy nhất

## Vì sao
- Luồng duyệt HĐ hiện có **hai chỗ sửa**: form Sổ Hợp Tác › Cài đặt › Quy trình duyệt (nguồn gốc, biên dịch thành def
  `contracts-approval` — `approval-flow.rules.ts` `compileDef`, `engineFlowDefSync`) và canvas ai-admin › Quy trình (lưu được nhưng
  lần lưu form kế tiếp **ghi đè** — đã kiểm 31/10). Người dùng không biết sửa ở đâu.
- Sổ Hợp Tác **ghi cứng** ký hiệu `contracts-approval` (`APPROVAL_PROCESS_KEY`, `approval-engine.usecase.ts`) ⇒ không chọn được
  quy trình khác, không clone rồi gắn được, không dùng chung một quy trình cho nhiều tenant.
- Quy trình mẫu ("Duyệt đề nghị chi", AISDLC) nằm chung danh sách với quy trình thật nhưng **không app nào dùng** ⇒ rối.
- Người dùng (31/10): "admin xem hết quy trình hợp đồng A, B; tenant nào gắn quy trình nào thì Sổ Hợp Tác chạy theo quy trình đó";
  "quy trình mẫu lọc hẳn ra"; "chỗ sửa gom lại cho đơn giản".

## Thay đổi gì
1. **Khe quy trình của app (slot).** Mỗi app khai báo khe nó cần, v1: `contracts.approval` (Sổ Hợp Tác — duyệt HĐ). Khe ghi rõ
   input bắt buộc (`contract-id`), các nút hệ thống bắt buộc (`contracts-route` chọn bước kế, `contracts-finalize` ghi Đã duyệt) và
   loại điều kiện được dùng (loại HĐ, giá trị). App khác sau này (Community…) thêm khe cùng cơ chế.
2. **Thư viện quy trình cấp nền tảng.** Platform admin tạo/sửa "Quy trình hợp đồng A", "B"… gắn **"Dùng cho: Sổ Hợp Tác ·
   duyệt HĐ"** (= khe). Danh sách ai-admin › Quy trình có cột **Dùng cho** và **Tenant đang dùng**. Quy trình đang được gán: không
   xoá/tắt được, ký hiệu khoá.
3. **Gán theo tenant — luật: 1 tenant × 1 khe của app = đúng 1 quy trình** (ràng buộc duy nhất trong DB; gán quy trình khác ⇒
   thay thế, không có hai quy trình cùng lúc). Ví dụ X → A, Y → B, Z → A. Một quy trình gán được cho nhiều tenant. Gán ở trang tenant
   và ngay trong quy trình ("Gán cho tenant…"). Chỉ platform admin gán.
   **Sổ Hợp Tác tra quy trình theo tenant mỗi lần mở lượt duyệt** (khi HĐ vào duyệt, theo tenant của HĐ — không phải lúc đăng
   nhập): đổi gán xong thì HĐ vào duyệt ngay sau đó chạy quy trình mới, không cần người dùng đăng nhập lại. Thay ký hiệu ghi cứng
   `contracts-approval`. Tenant chưa có gán ⇒ dùng quy trình mặc định của khe (B4).
4. **Một chỗ sửa: editor ai-admin, hai cách xem.** Nút **Canvas / Form**: Form = danh sách bước tuần tự (tên, phòng ban, người
   duyệt, hạn, nhắc, chuyển cấp, điều kiện loại HĐ/giá trị, bước Ký số — như form cũ). Quy trình có thứ Form không biểu diễn được
   (vd bước song song) ⇒ Form chỉ xem + "sửa ở Canvas". Nút hệ thống của khe hiện trên canvas nhưng khoá (không xoá).
5. **Phòng ban theo mã, phân giải theo tenant.** Bước trỏ Group bằng **mã** (`pb-ke-toan`…), không id ⇒ một quy trình dùng được cho
   nhiều tenant. Lúc gán/xuất bản: tenant thiếu phòng ⇒ báo, không cho gán.
6. **Clone → chỉnh → gán.** Nút **Nhân bản** trên mọi quy trình (kể cả quy trình đang dùng): A ⇒ bản mới A′ (nháp), chỉnh A′ thoải
   mái (không ảnh hưởng ai), xuất bản, **gán A′ cho tenant cần** (vd tenant X: A → A′). Sửa thẳng A ⇒ mọi tenant đang gán A đổi theo
   (cho lượt mới).
7. **Bỏ form trong Cài đặt Sổ Hợp Tác** ⇒ thay bằng khối "Quy trình duyệt đang dùng: A · v4" (sơ đồ chỉ xem + "Xem trước đường
   đi") và link sang editor cho người có quyền.
8. **Lọc hẳn quy trình mẫu.** Danh sách mặc định chỉ quy trình thật; mẫu chạy thử ở mục riêng **"Mẫu · chạy thử"**; lượt chạy từ
   trang chạy thử đánh dấu "thử", không lẫn lượt thật.

## Bổ sung đề xuất (cho đơn giản mà mạnh hơn) — cần chốt
- **B1 · Nháp / Xuất bản + lịch sử.** Sửa trên bản nháp; **Xuất bản** mới áp dụng; xem lịch sử phiên bản, so sánh, **quay lại
  một bấm**. Tránh lỡ tay sửa thẳng quy trình đang chạy cho nhiều tenant.
- **B2 · Kiểm trước khi xuất bản.** Đủ nút hệ thống của khe; không có bước không tới được; mọi tenant đang gán có đủ phòng ban;
  điều kiện chỉ dùng trường hợp lệ. Lỗi ⇒ không cho xuất bản, chỉ rõ chỗ sai.
- **B3 · Xem trước đường đi trong editor.** Nhập loại HĐ + giá trị mẫu (hoặc chọn một HĐ thật, không ghi gì) ⇒ tô bước chạy/bỏ
  qua — như "Xem trước đường đi" của form cũ, cho mọi quy trình.
- **B4 · Quy trình mặc định cho tenant mới.** Mỗi khe có một quy trình mặc định; tenant mới (onboarding `deploy/tenants/*.yaml`)
  tự gán; yaml ghi đè được (`approval_process: <ký hiệu>`).
- **B5 · Tác động khi sửa.** Trước khi xuất bản hiện: N tenant đang dùng, M lượt đang chạy (giữ bản cũ — như nay).
- **B6 · Nhật ký.** Ghi audit mọi lần xuất bản, gán, quay lại (ai, lúc nào, bản nào).

## Giữ nguyên
- Lượt đang chạy giữ phiên bản lúc bắt đầu (`process_runs.def_version` + `snapshot`) — không áp bản mới cho lượt dở.
- Cổng engine theo tenant (`CONTRACTS_APPROVAL_ENGINE=on` + feature `contracts-approval-engine`); tenant chưa bật ⇒ máy 2 bước cũ.
- Engine, node registry (CR-103), quyền duyệt theo Group.

## Không làm (v1) — CR sau
- Hộp việc duyệt cho thành viên phòng ban (không chỉ admin) khi hub ở `HUB_PROCESS_ROUTES=admin`.
- Form "Chạy" sinh theo trường nhập cho quy trình chạy tay; app kích hoạt quy trình tự soạn ngoài khe (vd "Gửi duyệt đề nghị chi").
- "Ngoại lệ theo tenant" đặt trên quy trình chung **mà không clone** (vd "A nhưng tenant X ngưỡng 300tr") — rối, bỏ; muốn khác ⇒
  clone A thành A′ rồi gán (mục 6).

## Chuyển dữ liệu
- Tenant đã lưu mẫu riêng (`contracts.approval_flows`) ⇒ tạo quy trình thư viện "Quy trình HĐ – <tên tenant>" từ mẫu đó, gán cho
  tenant. Tenant chưa lưu ⇒ gán **"Quy trình HĐ mặc định"** (dựng từ `defaultFlowFromSettings`). Phòng ban id ⇒ mã.
- Def `contracts-approval` theo tenant cũ giữ cho lượt đang chạy tới khi xong; lượt mới dùng quy trình đã gán.
- Prod hiện chỉ `demo` chạy engine ⇒ chuyển 1 tenant thật; tenant khác vẫn máy cũ.

## Chia lát (Luật 0c)
| Lát | Model | Nội dung |
|---|---|---|
| L1 `slot-core` | **Opus medium** | Khe `contracts.approval` + bảng gán tenant × khe (migration, RLS, chỉ platform admin ghi) + Sổ Hợp Tác mở lượt theo gán (thay `APPROVAL_PROCESS_KEY`) + phân giải phòng ban theo mã + int (gán X→A, Y→B chạy đúng; đọc chéo tenant bị chặn) |
| L2 `library-api` | **Opus medium** | Quy trình cấp nền tảng (tenant `platform`) dùng cho tenant khác; nháp/xuất bản/lịch sử/quay lại (B1); kiểm trước xuất bản (B2); chuyển dữ liệu |
| L3 `editor-ui` | Sonnet high | Editor: nút Canvas/Form (Form = bước tuần tự, như form cũ), khoá nút hệ thống, cột Dùng cho / Tenant đang dùng, Nhân bản, Gán cho tenant, xem trước đường đi (B3), tác động (B5), lọc "Mẫu · chạy thử" |
| L4 `sht-settings` | Sonnet | Bỏ form Cài đặt › Quy trình duyệt ⇒ khối "đang dùng A · vN" + link; e2e |
| L5 `onboard-default` | Sonnet | Quy trình mặc định của khe + yaml `approval_process` (B4) |
| dò code, chạy lại test, docs/current | Haiku | |

## Quyết định (người dùng chốt 2026-10-31: "Duyệt theo đề xuất")
1. Lấy cả B1–B6.
2. Chỉ platform admin sửa quy trình thư viện và gán cho tenant.
3. Tên khe trên UI: **"Sổ Hợp Tác · Duyệt hợp đồng"**.
4. Bỏ form Cài đặt › Quy trình duyệt ngay trong đợt này.
5. (trước đó) Sửa A ⇒ mọi tenant dùng A đổi theo; khác ⇒ clone A′ rồi gán; một chỗ sửa ở editor ai-admin (Canvas/Form); mẫu chạy
   thử lọc hẳn ra; 1 tenant × 1 khe = 1 quy trình, Sổ Hợp Tác tra theo tenant mỗi lần mở lượt duyệt.

## Câu hỏi đã chốt (giữ để tra)
1. Lấy cả **B1–B6**, hay bớt cái nào? (Đề xuất: lấy cả; B5–B6 nhỏ.)
2. **Người sửa quy trình thư viện:** chỉ platform admin (đề xuất — vì sửa một lần ảnh hưởng nhiều tenant), hay cho chủ gói Sổ
   Hợp Tác của tenant sửa bản Nhân bản riêng của mình?
3. **Tên hiển thị khe** trên UI: "Sổ Hợp Tác · Duyệt hợp đồng" được chưa?
4. **Bỏ form cũ ngay** trong đợt này (đề xuất), hay giữ song song một thời gian?
