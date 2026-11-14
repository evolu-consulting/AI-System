# CR-146 · tasks (lát cr146a-flow-list)

| Lát | Việc | Đọc | Xong |
|---|---|---|---|
| cr146a-flow-list | API danh sách flow Bật + UI Quy trình duyệt dạng danh sách + tab «Kết nối» | decisions.md mục 1–5, 8 | [x] |
| cr146b | Panel node Ký bắt buộc, bỏ signer_group_id, ngưỡng/người phụ trách vào quy trình Nhận HĐ | decisions.md mục 6–7 | [ ] |

## Delta (thay yêu cầu ở `docs/current/sht/cai-dat-va-quyen.md:90-93`)

#### Yêu cầu: Cài đặt › Quy trình duyệt liệt kê MỌI quy trình đang bật (thay «một quy trình đang chạy»)
Cài đặt liệt kê mọi quy trình Bật cho hợp đồng theo thứ tự xét (`company_flows.position`), mỗi dòng có «Bắt đầu khi» bằng chữ nghiệp vụ (không điều kiện ⇒ «Mọi hợp đồng còn lại») và số bước; hợp đồng đi theo quy trình ĐẦU TIÊN khớp (luật `match.rules.ts`). Bấm một dòng ⇒ sơ đồ (công tắc Sơ đồ | Danh sách) + khối chỉ xem «Ký và đối tác của quy trình này». Mọi nhân viên xem được; «Mở trang Quy trình» chỉ quản trị. Chưa có quy trình Bật ⇒ `GET` trả `{items: []}` (200, không còn 404); đường một-flow `other_flows` đã gỡ.
- Kịch bản: khi có 3 flow Bật và 1 Tắt thì trả đúng 3 theo `position` kèm đúng «Bắt đầu khi», tenant khác không thấy [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » CR-146 · 3 flow Bật + 1 Tắt ⇒ đúng 3, đúng thứ tự `position`, đúng «Bắt đầu khi»; tenant khác không thấy; số câu SQL cố định]
- Kịch bản: khi chỉ có flow Tắt thì trả danh sách rỗng [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » công ty chỉ có flow Tắt ⇒ 200 `items: []`, PUT không còn route]
- Kịch bản: khi đọc args stage Ký / Gửi đối tác thì dựng khối ký, đối tác của chính flow [test: apps/hub-api/src/modules/packs/contracts/domain/event-flow-steps.rules.test.ts » CR-146 · signPartnerOf (khối ký / đối tác chỉ xem)]
- Kịch bản: khi hiển thị «Bắt đầu khi» thì dùng chữ nghiệp vụ, phòng theo tên [test: apps/workspace-web/src/features/settings/lib/start-when.test.ts » start-when · chữ nghiệp vụ]
- Kịch bản: khi quản trị dựng quy trình thì Cài đặt hiện danh sách + «Mọi hợp đồng còn lại» + khối ký [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 2 · platform admin dựng quy trình từ sơ đồ trống + áp dụng ⇒ Cài đặt hiện CÙNG tên với tab Quy trình, không còn 'Quy trình HĐ mặc định']

#### Yêu cầu: Tab «Ký & đối tác» đổi thành «Kết nối» (chỉ kết nối cấp công ty)
Tab chỉ còn kết nối/công tắc ký số và trạng thái «Đối tác xác nhận». Khối «Người ký HĐ» và ngưỡng/người phụ trách hợp đồng nhận gỡ khỏi UI (backend gỡ ở cr146b).
- Kịch bản: khi mở tab thì nhãn là «Kết nối» [test: packages/i18n/src/settings-paths.test.ts » CR-138b · tab Kết nối]
- Kịch bản: khi bật công tắc ký số trong tab Kết nối thì lưu được [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 3 · công tắc ký số trong Cài đặt bật được thật (lưu, tải lại vẫn bật)]

## Quyết định trong lúc làm
- `GET /approval-flow` trả `{items}` (200, rỗng khi chưa bật) thay vì 404 — một đường duy nhất (G1).
- Tên người ký (user) lấy từ `packAssignees` (người có quyền đọc gói), 1 câu SQL cố định; không thấy ⇒ «người đã nghỉ hoặc không còn quyền».
- «Ký qua» (nhà cung cấp) chưa hiện: node Ký đã bỏ provider (CR-125 m4); cr146b thêm cùng lúc bắt buộc chọn.
- Số câu SQL API: ≤ 6 cố định (eventFlows 1, cài đặt cấp 2, idsOf, list Group, memberCounts, tên người ký).
