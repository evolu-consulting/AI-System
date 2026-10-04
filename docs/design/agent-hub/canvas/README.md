# Canvas Agent Studio

Người dùng duyệt hướng UI ngày 2026-10-04. Bản sống: https://claude.ai/artifact/LXYq4QDMbgpYQWmsgMSa6Q (riêng tư). Đây là đầu vào cho mốc H4 (Studio).

| Artboard | Màn | Mục đặc tả |
|---|---|---|
| `Main.dc.html` | Agents — danh sách | ui-agent-studio §5.1 |
| `AgentEditor.dc.html` | Agent — tạo / sửa (5 bước + Xem như Orchestrator thấy + Chạy thử) | §5.2 |
| `Orchestrator.dc.html` | Orchestrator mặc định, theo tenant (CR-032), kiểm thử định tuyến, Dry-run | §6 |
| `Models.dc.html` | Providers (trạng thái, slot, cooldown), Profiles (chuỗi bước dự phòng) | §8 |
| `Access.dc.html` | Ma trận agent × tenant + drawer chi tiết grant | §9 |
| `Playground.dc.html` | Chat thử (Consultant, gợi ý `@agent` CR-033) + trace waterfall | §10 |

- Token màu/chữ dùng chung Admin (`../../canvas/tokens-map.md`): Be Vietnam Pro, JetBrains Mono, `--primary #6B4FA0`.
- Chỉ light mode. Chưa vẽ: Tổng quan, Tools, Secrets, Vận hành (Runs/Chi phí/Jobs), Nhật ký, Import/Export — theo mẫu Admin, vẽ khi làm H4.
- Dữ liệu trong artboard là mẫu (tên agent/tenant từ docs).
