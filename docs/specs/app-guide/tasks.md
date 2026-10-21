# app-guide — hướng dẫn dùng sản phẩm cho agent chat (làn nhanh)
- Nội dung: `apps/hub-api/src/modules/guide/content/*.md` (VI + EN ngắn, nhãn lấy từ i18n/UI hiện tại; mockup chỉ là dữ liệu).
- Tool `app-guide` (pack `app`, `open: true` = tool lõi chỉ đọc, bỏ qua cổng entitlement gói): `query` tìm / `id` lấy mục. Lọc theo người gọi: mục `audience: admin` chỉ cho tenant_admin/platform_admin (đọc `admin.users.role`); mục `pack: contracts` chỉ khi gói hợp đồng bật cho tenant và người gọi có `read`.
- Cấp cho `assistant`, `mgmt-assistant` (`agents.yaml` pack_tools + prompt). Orchestrator không giữ tool (quyết định JSON) ⇒ prompt giao câu "làm sao/ở đâu/cách dùng" cho `assistant`.
- Test: unit `guide.rules.test.ts`, int `guide.tool.int.test.ts` (evotest xanh), e2e `e2e/deployed/06-guide.deployed.ts` (đã viết, chưa chạy).
- Sau deploy: chạy `hub:seed` (agents.yaml đổi pack_tools + prompt). Không cần migration/cấu hình khác.
