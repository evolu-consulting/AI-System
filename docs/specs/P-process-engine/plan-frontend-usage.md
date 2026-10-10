# P · Phụ lục plan-frontend: màn ⑧ Token (chuyển từ plan-frontend §7, nội dung không đổi)

Thuộc [`plan-frontend.md`](plan-frontend.md). Chuỗi: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) §6 (`usage.*`).

## 1. Màn ⑧ — Token (PF4 · `chat-web/.../usage/`, admin `features/processes/components/usage/`)
| Hạng mục | Chi tiết |
|---|---|
| Mới (chat) | `components/{UsageTab,UsageKpis,StageUsageTable,CallsTable}.tsx` · `lib/usage-view.ts` (thuần: định dạng, gộp cột Cache = read+write, nhãn `role`) · `api.ts` (`useRunUsage`: `GET /process-runs/:id/usage`, `staleTime` 15 s, invalidate khi `process.updated` của run) |
| KPI | Tổng token · Vào · Ra · Cache · Lượt gọi (`totals`; số theo `Intl.NumberFormat(lang)`) |
| Bảng giai đoạn | `table "Token theo giai đoạn"`: Giai đoạn · Lần chạy (`attempts`) · Hỏi lại (`asks_count`) · Lượt gọi · Vào · Ra · Cache · Tổng; `detail=full` ⇒ hàng có `button "Xem lượt gọi giai đoạn {{name}}"` (`aria-expanded`) mở: team-run (mode, trạng thái, `stop_reason`, thời gian chạy) + `CallsTable` (Vai · Agent · Model · Thời gian · Vào · Ra · Cache · Tổng; model `null` ⇒ "—") |
| `summary` | (người xem `task`, C5) chỉ KPI + bảng giai đoạn **không** mở rộng + chú thích "Bạn chỉ xem tổng theo giai đoạn." |
| Trạng thái | tải · lỗi + "Thử lại" · rỗng (`totals.calls=0`: "Chưa có lượt gọi nào") · 404 như trang. Chú thích đáy: "Chỉ đếm token (từ nhật ký sử dụng). Quy ra tiền khi có quota (H3c)." |

