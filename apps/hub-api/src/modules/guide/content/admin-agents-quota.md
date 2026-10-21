---
id: admin-agents-quota
title: Quản trị — Agents, Chi phí và quota, Nhật ký
title_en: Admin — agents, usage and quota, audit log
audience: admin
pack: none
keywords: quản trị admin agent mặc định quota chi phí hạn mức nhật ký audit tổng quan tenant
---

## Cho nhóm hay người dùng một agent (Agents)
1. Vào **Agents** trong Quản trị.
2. Ở dòng agent (cột **Ai được dùng**), bấm **Cấp quyền**.
3. Chọn **Phạm vi**: **Cả công ty** hoặc **Chọn nhóm và người**, rồi lưu. Dòng "Kết quả: ..." tóm tắt ai được dùng.
Cột **Bật cho công ty** chỉ quản trị nền tảng đổi được; agent được định nghĩa ở Agent Forge.

EN: Agents > "Cấp quyền" on the agent row; pick whole company or groups/people.

## Đặt agent mặc định và cách xử lý khi không khớp agent
Agent mặc định (★ Mặc định) là agent trả lời ở Hỏi AI khi người dùng không gõ @agent. Luôn có đúng một agent mặc định.
1. Vào **Agents**, bấm **Đặt mặc định** ở agent muốn chọn.
2. Mục "Không khớp agent nào →" chọn **Tự trả lời** hoặc **Hỏi lại người dùng**.

EN: Agents > "Đặt mặc định" sets the agent answering untagged questions.

## Xem chi phí và đặt hạn mức (Chi phí & quota)
Vào **Chi phí & quota** (nhóm HỆ THỐNG): chọn **Kỳ** (**Tháng này** / **Tháng trước**), xem **Số run**, **Token**, **Số thu**, chi phí theo tenant, **Top feature**, **Top user**; bấm **Xuất CSV** để tải. Vượt quota không chặn, phần vượt được tính phí riêng. Trang **Tổng quan** có thẻ "Quota tháng" và liên kết "Xem chi phí & quota". Hạn mức tháng do quản trị nền tảng đặt cho tenant (tab **Quota** của tenant).

EN: Chi phí & quota shows usage per month; exceeding quota does not block use.

## Xem ai đã đổi gì (Nhật ký)
Vào **Nhật ký** (Audit) để xem dòng thời gian thay đổi cấu hình trong công ty: lọc theo người thực hiện và loại thay đổi, bấm một dòng để xem chi tiết trước/sau. Trang **Tổng quan** có khối "Thay đổi gần đây".

EN: Nhật ký lists configuration changes with before/after details.

## Trang Tổng quan quản trị
Vào **Tổng quan**: thấy **Users đang hoạt động**, **Groups**, **Số run tháng này**, **Quota tháng**, danh sách "Người dùng mới chưa đăng nhập" và "Thay đổi gần đây". Quản trị nền tảng còn tạo tenant (**Tạo tenant**) và thấy tenant sắp vượt quota.

EN: Tổng quan summarises active users, groups, runs and quota.
