# docs/current — hành vi ĐANG chạy

Mục đích: một chỗ sạch mô tả **hệ thống làm gì ngay bây giờ** (trên `platform/gd0`), để agent đọc thay vì lần qua nhiều spec/CR cũ. Đây là nguồn sự thật cho agent khi hỏi "hành vi hiện hành là gì". Không ghi kế hoạch, không ghi lịch sử.

- **Lịch sử và lý do** nằm ở `docs/CHANGE-REQUESTS.md` (CR) và `docs/specs/<lát>/tasks.md` (quyết định trong lúc làm). Mỗi mục ở đây ghi nguồn (lát/CR) để truy ngược.
- **Spec thắng (như OpenSpec).** Đây là hành vi đã duyệt; chỉ đổi qua Delta của lát hoặc CR. Code lệch ⇒ không tự sửa bên nào: đánh dấu `⚠ Lệch code: <file:dòng>` tại mục và đưa vào báo cáo cuối đợt để người dùng chốt (lỗi ⇒ sửa code; quyết định mới ⇒ Delta/CR). Chỗ chưa kiểm được ghi ở mục "Chưa rõ" cuối file, không đoán.
- Ngoại lệ một lần: bản đầu (2026-10-27) được viết ngược từ code, nên phản ánh code tại thời điểm đó.
- **Cách cập nhật:** mỗi lát có mục `## Delta (so với docs/current)` trong `tasks.md`; cuối đợt `docs-architect` gộp Delta vào đây và đánh dấu lát đã gộp (`docs/WORKFLOW.md` "Gộp docs/current cuối đợt"). Không sửa tay giữa đợt trừ khi sửa lỗi sự thật.
- File ≤ 400 dòng; dài hơn thì tách theo khu vực.

## Định dạng Delta (ADR-0032)
Trong `## Delta (so với docs/current)` của `tasks.md`:
```
Trạng thái gộp: chưa gộp            (sau gộp: đã gộp YYYY-MM-DD (đợt <tên>))

### MODIFIED sht/chung-tu.md          (hoặc ADDED <file mới> / REMOVED <file>)
#### Yêu cầu: Mở lại chứng từ
Người phụ trách hoặc owner được mở lại.
- Kịch bản: khi người phụ trách bấm "Mở lại" thì chứng từ về Nháp [test: e2e/sht/mo-lai.spec.ts » mở lại về Nháp]
```
- Mỗi khối `###` trỏ **một file trong `docs/current`** (đường dẫn tương đối). MODIFIED/REMOVED yêu cầu file đã có; ADDED được tạo file mới.
- Mỗi `#### Yêu cầu: <tên>` (ADDED/MODIFIED) có mô tả và **≥ 1** dòng `- Kịch bản: khi … thì …`. REMOVED chỉ cần dòng `Lý do: …`.
- Mỗi `- Kịch bản:` (ADDED/MODIFIED, lát "chưa gộp") kết thúc bằng `[test: <đường dẫn từ gốc repo>]` hoặc `[test: <đường dẫn> » <đoạn tiêu đề test>]` (nhiều mục cách nhau `;`); không có test tự động thì `[test: thủ công — <lý do>]`. `openspec:check` kiểm file tồn tại và tiêu đề có trong file (tìm văn bản, không chạy test); lát "đã gộp" không kiểm lại.
- Lát không đổi hành vi (hạ tầng/test/nhãn): thay các khối bằng đúng một dòng `Không thay đổi hành vi (lý do: …)`.
- Lệnh: `bun run openspec:check [lát…]` (kiểm; `slice:merge` tự chạy), `bun run openspec:pending` (lát chưa gộp + file đích, dùng khi gộp cuối đợt), `bun run openspec:archive <lát> [--dot <tên>]` (chỉ ghi sổ "đã gộp"; việc gộp văn xuôi vào đây vẫn do docs-architect).

Viết tắt đường dẫn: `H` = `apps/hub-api/src/modules/packs/contracts`, `W` = `apps/workspace-web/src`, `C` = `packages/contracts/src/pack-contracts`, `MG` = `packages/db/migrations-pack-contracts`, `T` = `tests/acceptance`.

## Mục lục

| Khu vực | File | Nội dung |
|---|---|---|
| Sổ Hợp Tác (app `contracts`) | [sht/chung-tu.md](sht/chung-tu.md) | 3 loại chứng từ, phiên bản, mở lại, phụ lục chỉ đọc, xoá, danh sách |
| | [sht/mot-moc-kho-cong-no.md](sht/mot-moc-kho-cong-no.md) | Mốc, giao theo %, vượt tồn, xác nhận + xem trước tác động |
| | [sht/duyet-ky-so.md](sht/duyet-ky-so.md) | Quy trình duyệt (máy 2 bước / engine), khoá, ký số |
| | [sht/doi-tac-uy-tin.md](sht/doi-tac-uy-tin.md) | Điểm uy tín (HD8 / V2-E theo cờ), cờ đỏ, xem trước chuyển engine |
| | [sht/sp-va-gia.md](sht/sp-va-gia.md) | SP & Giá: giá có VAT/hạn, thay/gỡ mềm, Lịch sử giá, nguồn Báo giá |
| | [sht/cai-dat-va-quyen.md](sht/cai-dat-va-quyen.md) | Vai/quyền, màn Cài đặt, cờ và công tắc |
| | [sht/phap-ly-va-can-xu-ly.md](sht/phap-ly-va-can-xu-ly.md) | Cảnh báo pháp lý, nguồn Cần xử lý |

| Community (gói `community`) | [community/README.md](community/README.md) · [community/i18n.md](community/i18n.md) | Nghiệp vụ, ma trận hiển thị, VI/EN, Chưa rõ (CR-102) |
| Engine quy trình (CR-103) | [engine/flow-engine.md](engine/flow-engine.md) | Registry node, If, set, đổi node, canvas/drawer, showcase, route HUB_PROCESS_ROUTES, catalog tool |
| | [engine/thu-vien-quy-trinh.md](engine/thu-vien-quy-trinh.md) | Thư viện quy trình (CR-105): khe, gán tenant, mặc định, xuất bản, nhân bản |
| Admin (ngắn) | [admin/ghi-chu.md](admin/ghi-chu.md) | Người dùng ngoài / công ty đối tác, cổng admin-api cho đối tác |
| | [admin/cau-hinh-app.md](admin/cau-hinh-app.md) · [admin/nang-luc.md](admin/nang-luc.md) · [admin/slot-flow-review-badge.md](admin/slot-flow-review-badge.md) | CR-118: trang cấu hình app, năng lực `/pack/me`, huy hiệu khe |
| Web gộp (CR-118) | [web/web-hop-nhat.md](web/web-hop-nhat.md) · [sht/feature-gate-web.md](sht/feature-gate-web.md) · [sht/home-default-app.md](sht/home-default-app.md) | Một web, một phiên, FeatureGate OpenFeature, home theo default_app |
| Engine flow (CR-118) | [engine/flow-runtime.md](engine/flow-runtime.md) · [engine/flow-web.md](engine/flow-web.md) | FlowRuntime của kit, renderer + form phía web |
| Gửi đối tác / danh bạ (CR-124/125) | [sht/gui-doi-tac-xac-nhan.md](sht/gui-doi-tac-xac-nhan.md) · [sht/gui-doi-tac-q4.md](sht/gui-doi-tac-q4.md) · [sht/gui-doi-tac-giao-dien.md](sht/gui-doi-tac-giao-dien.md) · [sht/gui-doi-tac-cong-tinh-nang.md](sht/gui-doi-tac-cong-tinh-nang.md) · [sht/doi-tac-tra-loi-qua-email.md](sht/doi-tac-tra-loi-qua-email.md) · [sht/email-moi-ky-so.md](sht/email-moi-ky-so.md) · [platform/company-directory.md](platform/company-directory.md) · [platform/partner-links.md](platform/partner-links.md) | Gửi đối tác xác nhận, hộp thư liên công ty, danh bạ, nối đối tác, email Mời ký |
| | [engine/so-module-khoi-dong.md](engine/so-module-khoi-dong.md) | Sổ module tính năng (CR-125): kiểm lúc khởi động, MOD_*, module:index/new, check:modules |

| Flow theo sự kiện (CR-122/123) | [engine/flow-def.md](engine/flow-def.md) · [engine/flow-def-save.md](engine/flow-def-save.md) · [engine/flow-triggers.md](engine/flow-triggers.md) · [engine/flow-templates.md](engine/flow-templates.md) · [engine/app-events.md](engine/app-events.md) · [engine/flow-events-emit.md](engine/flow-events-emit.md) | FlowDef, lưu, kích hoạt theo sự kiện, mẫu sạch, sự kiện app |
| | [engine/company-flows.md](engine/company-flows.md) · [engine/company-flows-pair.md](engine/company-flows-pair.md) · [engine/node-palette.md](engine/node-palette.md) · [engine/flow-bridge.md](engine/flow-bridge.md) | Flow của công ty, cặp node module, bảng node, cầu nối AI |
| | [pack-contracts/](pack-contracts/) · [contracts/partner-pick.md](contracts/partner-pick.md) · [web/hop-dong-partner-pick.md](web/hop-dong-partner-pick.md) · [community/su-kien-flow.md](community/su-kien-flow.md) | Sự kiện flow của Hợp đồng/Community, ký số theo node, chọn đối tác |
| Trình soạn quy trình (CR-122/123) | [platform/trinh-sua-flow.md](platform/trinh-sua-flow.md) · [platform/canvas-flow-nghiep-vu.md](platform/canvas-flow-nghiep-vu.md) · [platform/node-config-panel.md](platform/node-config-panel.md) · [platform/danh-sach-flow-cong-ty.md](platform/danh-sach-flow-cong-ty.md) · [platform/kiem-noi-node.md](platform/kiem-noi-node.md) · [platform/dich-buoc-flow.md](platform/dich-buoc-flow.md) · [platform/node-bat-dau-khi-canvas.md](platform/node-bat-dau-khi-canvas.md) | Trình soạn, canvas, panel node, danh sách, kiểm nối |
Khu vực khác (Agent Hub lõi, Worker, Chat) chưa có `current/`; dùng `docs/design/**` + CODEMAP tới khi có.

## Gộp đợt cr125-wave (nhóm A: admin, platform, hub, tools, deploy, ops)

File mới (mỗi file ghi nguồn lát; mục MODIFIED nằm cuối file cũ ở phần "Delta gộp 2026-11-09"):

- **admin/**: [ban-rieng-nguon-thu-vien.md](admin/ban-rieng-nguon-thu-vien.md) · [cau-hinh-gui-mail-mot-nguon.md](admin/cau-hinh-gui-mail-mot-nguon.md) · [cong-ty-5-tab.md](admin/cong-ty-5-tab.md) · [cong-ty-cai-dat.md](admin/cong-ty-cai-dat.md) · [cong-ty-gan-quy-trinh-loi.md](admin/cong-ty-gan-quy-trinh-loi.md) · [cong-ty-lam-tuoi-nang-luc.md](admin/cong-ty-lam-tuoi-nang-luc.md) · [cong-ty-quy-trinh-gon.md](admin/cong-ty-quy-trinh-gon.md) · [cong-ty-quy-trinh-nguon.md](admin/cong-ty-quy-trinh-nguon.md) · [cong-ty-quy-trinh.md](admin/cong-ty-quy-trinh.md) · [cong-ty-ung-dung-gon.md](admin/cong-ty-ung-dung-gon.md) · [danh-sach.md](admin/danh-sach.md) · [dieu-huong-shell-r2.md](admin/dieu-huong-shell-r2.md) · [feature-ung-dung.md](admin/feature-ung-dung.md) · [gui-mail-qua-hub.md](admin/gui-mail-qua-hub.md) · [he-thong-danh-muc-tinh-nang.md](admin/he-thong-danh-muc-tinh-nang.md) · [he-thong-nguon-tenant-admin.md](admin/he-thong-nguon-tenant-admin.md) · [ho-so-cong-ty.md](admin/ho-so-cong-ty.md) · [khung-giao-dien.md](admin/khung-giao-dien.md) · [kiem-tra-vai-app.md](admin/kiem-tra-vai-app.md) · [ngan-viec-bo-cuc.md](admin/ngan-viec-bo-cuc.md) · [ngan-viec-mo-chi-tiet.md](admin/ngan-viec-mo-chi-tiet.md) · [ops-watch-flow-coverage.md](admin/ops-watch-flow-coverage.md) · [ops-watch-slo.md](admin/ops-watch-slo.md) · [platform-mo-ban-rieng-cong-ty.md](admin/platform-mo-ban-rieng-cong-ty.md) · [processes-run-links.md](admin/processes-run-links.md) · [processes-run-page.md](admin/processes-run-page.md) · [sidebar-cong-ty.md](admin/sidebar-cong-ty.md) · [thu-vien-bang-gon.md](admin/thu-vien-bang-gon.md) · [thu-vien-cot-cac-buoc.md](admin/thu-vien-cot-cac-buoc.md) · [thu-vien-khong-gan-truc-tiep.md](admin/thu-vien-khong-gan-truc-tiep.md) · [thu-vien-quy-trinh-bang.md](admin/thu-vien-quy-trinh-bang.md) · [tinh-trang-he-thong.md](admin/tinh-trang-he-thong.md) · [tong-quan-bento.md](admin/tong-quan-bento.md) · [tong-quan-platform.md](admin/tong-quan-platform.md) · [tong-quan-quota-rut-gon.md](admin/tong-quan-quota-rut-gon.md) · [tong-quan-van-hanh.md](admin/tong-quan-van-hanh.md) · [trang-luot-chay-tenant-admin.md](admin/trang-luot-chay-tenant-admin.md) · [trang-thai-badge-thong-nhat.md](admin/trang-thai-badge-thong-nhat.md) · [trinh-sua-danh-sach-buoc.md](admin/trinh-sua-danh-sach-buoc.md) · [trinh-sua-quy-trinh-chi-xem.md](admin/trinh-sua-quy-trinh-chi-xem.md) · [trinh-sua-thong-tin-don-gian.md](admin/trinh-sua-thong-tin-don-gian.md) · [wizard-onboard.md](admin/wizard-onboard.md) · [workspace-cong-ty.md](admin/workspace-cong-ty.md)
- **deploy/**: [](deploy/)
- **engine/**: [quy-tac-review-migration.md](engine/quy-tac-review-migration.md)
- **hub/**: [](hub/)
- **ops/**: [ops-watch-flow-coverage.md](ops/ops-watch-flow-coverage.md)
- **platform/**: [baseline-merge.md](platform/baseline-merge.md) · [giao-dich-db.md](platform/giao-dich-db.md) · [merge-abort.md](platform/merge-abort.md) · [tool-depcruise-exit.md](platform/tool-depcruise-exit.md)
- **tools/**: [](tools/)
| Sổ Hợp Tác bổ sung (CR-121/125) | [sht/ten-cong-ty-mot-nguon.md](sht/ten-cong-ty-mot-nguon.md) · [sht/mo-lai-platform-admin.md](sht/mo-lai-platform-admin.md) · [sht/thanh-duoi-dien-thoai.md](sht/thanh-duoi-dien-thoai.md) · [ops/flow-coverage.md](ops/flow-coverage.md) | Tên công ty một nguồn, platform admin mở lại HĐ/lượt kẹt, thanh dưới điện thoại, ops-watch flow_coverage |
