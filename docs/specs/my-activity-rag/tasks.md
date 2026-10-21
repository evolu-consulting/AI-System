---
id: my-activity-rag
lane: đầy đủ (cách ly tenant + riêng tư) — test cách ly viết trước code phần đó
---
# my-activity-rag — agent trả lời từ hoạt động + lịch sử chat của CHÍNH người hỏi

Người dùng chốt: "tất nhiên rag data của họ thôi" — chỉ dữ liệu của chính người hỏi; lịch sử bản ghi chỉ khi họ mở được bản ghi đó.

## Plan
| # | Việc | Làn |
|---|------|-----|
| 1 | Test cách ly int (`tests/acceptance/my-activity/isolation.int.test.ts`): A≠B cùng tenant, chéo tenant, lịch sử HĐ theo luật thấy (org), hạn lưu | đầy đủ |
| 2 | Hub 0050: FTS `hub.vi` (unaccent+simple), cột `hub.messages.search_tsv` STORED, GIN `(user_id, search_tsv)` (btree_gin) + btree `(tenant_id, user_id, created_at DESC)`, hàm `hub.my_admin_audit` | đầy đủ |
| 3 | Contracts 0038: index theo người làm (contract_events, partner_events, voids, delete_log) + số HĐ không phân biệt hoa thường | thường |
| 4 | Tool lõi `my-activity`, `my-chat-history` (pack `my`, `open`, `read`) — `modules/my-history/`; nguồn gói `ActivitySource` (`packs/kit/application/activity.ports.ts`), contracts cài ở `packs/contracts/activity.mount.ts` | đầy đủ |
| 5 | Cấp cho `assistant` + `mgmt-assistant` (agents.yaml) + prompt + điều phối | thường |
| 6 | Unit rules, perf 100k tin/người p95 ≤ 100 ms, e2e deployed 08 (chỉ viết) | — |

## Quyết định trong lúc làm
- Hai tool là tool LÕI (`open: true`, như `app-guide`) — không cần entitlement; tự lọc theo người gọi. Phần gói contracts chỉ chạy khi người gọi đọc được gói (`canReadPack`), bằng `PackUow` (role `contracts_rw` + RLS + luật thấy M1 của người gọi).
- `my-activity` mặc định = thao tác do CHÍNH người gọi làm (`actor_user_id`/`by_user`/`deleted_by` = người gọi; `contract_delete_log`, `partner_event_voids` chỉ có RLS tenant nên lọc người tường minh). Tham số `contract` (số/id) = lịch sử một HĐ người gọi mở được (policy `contract_events_visible`) — như trang chi tiết; tên người làm lấy từ `admin.users` cùng tenant.
- Audit Admin: hub không đọc được `admin.audit_log` ⇒ hàm `hub.my_admin_audit` SECURITY DEFINER lấy người từ `app.scope/app.tenant_id/app.user_id` của tx (`withHubScope` user) — chỉ cột tóm tắt (không before/after). Audit Hub: lọc `tenant_id` + `actor_id`.
- `my-chat-history`: chỉ `hub.messages` của người gọi (RLS tenant+user) — câu họ hỏi + trả lời cho họ, gồm hội thoại nền của phòng (tin của chính họ); KHÔNG đọc `room_messages` (tin thành viên khác). Bỏ hội thoại đã xoá + hội thoại nền quy trình + câu hỏi/trả lời của run đang gọi tool.
- Tìm hai pha, kế hoạch cố định (Luật 4c): pha 1 quét 2.000 tin mới nhất qua index thời gian rồi lọc `@@`; thiếu kết quả ⇒ pha 2
  GIN `(user_id, search_tsv)`. Tx đặt `jit=off`, `enable_seqscan=off`, `enable_bitmapscan=off` (pha 2 bật lại),
  `max_parallel_workers_per_gather=0` — policy RLS (OR + current_setting) làm ước lượng sai (~250 hàng) ⇒ planner chọn seq scan
  + sort / vòng lồng theo flows. Xếp hạng: ≤ 100 ứng viên mới nhất → `ts_rank / (1 + tuổi/30 ngày)` (`ts_rank_cd` tốn ~50 ms).
- **Perf (evotest, 100k tin/người + 20k nhiễu, 200 lượt 6 kiểu câu)**: p95 872,8 ms (bản đầu) → **25,5 ms** (p50 15,3, max 37,3).
- Từ khoá: bỏ dấu, bỏ hư từ, ≤ 2 từ AND, nhiều hơn OR. Không dùng embedding (module tri thức chưa có pgvector — TECH-DEBT).
- **Hạn lưu**: tenant config key `admin.tenants.settings.chat_history_months` (số nguyên 1–120, vắng/sai ⇒ 12). Màn Admin chưa sửa được `settings` (contract tenant chặn `settings`) ⇒ không thêm UI; đặt bằng SQL: `update admin.tenants set settings = settings || '{"chat_history_months": 6}' where key = '<tenant>'`.
- Thêm cột STORED `search_tsv` = ghi lại `hub.messages` một lần lúc migrate (khoá ngắn, bảng nhỏ trên sohoptac2).

## Còn lại
- e2e deployed 08 chạy ở lượt e2e cuối đợt (sau deploy + `hub:seed`).
