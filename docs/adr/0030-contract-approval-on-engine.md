# ADR-0030 · Duyệt hợp đồng chạy trên process engine (đảo một phần M3-decouple)

Trạng thái: **Accepted** (người dùng, 2026-10-23). Người dùng chốt trong Intake contract-flow: "làm đầy đủ"; mặc định áp dụng không hỏi lại. Liên quan: M3-decouple (`docs/specs/M3-decouple/tasks.md`, phần duyệt bị đảo), ADR-0017 (engine chạy bền), ADR-0023 (clean architecture), ADR-0029 (AI client chung), spec `docs/specs/contract-flow/tasks.md`.

## Bối cảnh
M3-decouple tách gói hợp đồng khỏi engine: duyệt hợp đồng chạy bằng máy trạng thái hai bước trong gói (cấp 1, cấp 2). Máy này cứng: chỉ hai cấp, một nhóm mỗi cấp, không có hạn, không nhắc, không chuyển cấp, không Trả lại về bước soạn, không bước Dify. Công ty cần duyệt qua nhiều phòng ban, mỗi công ty một luồng riêng, và quản trị tự thiết kế luồng. Engine quy trình đã có đủ các phần đó (steps, `canAct`, hạn, nhắc, escalation, bước tool/Dify), nên duyệt HĐ được chuyển sang engine. AI đọc hợp đồng vẫn nằm ở gói (ADR-0029).

## Lựa chọn
| Phương án | Được | Mất |
|---|---|---|
| **A. Giữ máy hai bước trong gói, thêm tính năng vào máy** | Không đổi kiến trúc M3-decouple | Phải tự làm lại hạn, nhắc, chuyển cấp, Trả lại, Dify: trùng engine, lệch dần |
| **B. Duyệt trên engine, máy cũ giữ cho lượt cũ** | Dùng lại engine; mỗi công ty tự thiết kế luồng; lượt đang chạy không đổi | Gói phụ thuộc cầu `PackRunsPort` tới engine; hai đường duyệt song song trong một thời gian |
| C. Chuyển toàn bộ lượt cũ sang engine ngay | Chỉ còn một đường | Rủi ro đổi trạng thái lượt đang mở; khó khôi phục |

## Quyết định: phương án B
1. **Bật bằng cờ.** `CONTRACTS_APPROVAL_ENGINE=on` và `HUB_PROCESS_ENGINE` đều phải bật. Tắt cờ ⇒ máy hai bước cũ như trước.
2. **Mẫu luồng theo tenant.** Bảng `contracts.approval_flows` (version, `steps` jsonb) do quản trị công ty sửa ở Cài đặt › "Quy trình duyệt". Bước review gồm phòng ban (cả nhóm, hoặc `head_only` chỉ trưởng phòng; phòng không có trưởng ⇒ cả nhóm), hạn, nhắc lặp, nhóm chuyển cấp, điều kiện theo loại HĐ và giá trị. Bước Dify chỉ chọn trong catalog có sẵn. Mẫu mặc định dựng từ `approval_settings` hiện có, giữ đúng hành vi hai bước khi tenant không sửa luồng.
3. **Biên dịch có kiểm soát.** `compileDef(flow, groupIds)` là hàm thuần trong domain gói, tạo def engine `contracts-approval`. Run chụp def lúc bắt đầu, nên sửa luồng không đổi run đang chạy. Điều kiện rẽ tính ở gói (`nextApplicable`), engine chỉ rẽ theo kết quả.
4. **Máy cũ chỉ còn cho lượt cũ.** `contracts.approvals.mode` = `machine` | `engine`. Lượt đang ở `machine` chạy nốt máy cũ (giữ `approval-machine.rules.ts`). Lượt mới mở cấp 1 sau khi đã commit thì gắn run engine; nếu engine lỗi (không có engine, nhóm mẫu đã xoá, start lỗi) thì ghi log và chạy máy cũ, không chặn người dùng.
5. **Quyền và định danh.** Người được quyết là `canAct` của engine. Người bắt đầu run là `started_by` (người mở lượt), không gán cho hệ thống. Lượt engine không bao giờ trả về máy cũ: khi run dừng hoặc lỗi, lượt được đánh dấu để quản trị mở lại quy trình, không rơi về máy hai bước.
6. **Bước cuối an toàn.** `contracts-finalize` chạy trong một transaction của gói, khoá HĐ, kiểm lại các bước bắt buộc theo giá trị hiện tại và `flow_version`, rồi áp gắn SP đang chờ (`pending_links`). Gọi lại khi đã xong ⇒ ok (idempotent).
7. **Thông báo theo lô.** Run có `pack_ref` thì notifier của engine ghi chuông contracts-web cùng transaction, mỗi lô một lần, không mỗi HĐ một thông báo. Reconcile trong `approval-sweep` xử lý 100 bản ghi mỗi lô bằng tập lệnh SQL (không vòng lặp từng dòng).

## Hệ quả
- Được: một engine cho mọi luồng duyệt; quản trị công ty tự thiết kế luồng nhiều phòng ban; có hạn, nhắc, chuyển cấp, Trả lại, bước Dify; mẫu mặc định giữ hành vi cũ.
- Mất: gói có thêm cầu tới engine; có hai đường duyệt song song đến khi lượt máy cũ cuối cùng đóng; mọi thay đổi luồng phải đi qua version và kiểm khớp hai chiều giữa DTO domain và `@ai/contracts`.
- Rủi ro đã biết và đã xử lý trong review: quyền bắt đầu run sai người (đã sửa: `started_by`); lượt engine bị trả về máy cũ khi lỗi (đã sửa: không trả về, đánh dấu mở lại); thông báo từng HĐ gây tràn chuông (đã sửa: một lần mỗi lô).
- Hạn chế còn lại: tenant chưa lưu mẫu mà đổi cài đặt duyệt (nhóm, ngưỡng) thì def v1 không đồng bộ lại; đường rẽ vẫn đúng vì tool dùng luồng đã chụp, nhưng nhóm duyệt có thể theo def cũ. Cần lưu mẫu (version mới) khi đổi cài đặt. Theo dõi trong `docs/STATE.md`.
- Tác động perf: GET thẻ duyệt giữ p95 ≤ 30 ms (engine tối đa hai câu SQL); timer và nhắc của engine dùng SKIP LOCKED.
