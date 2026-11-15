# tenant-connect — CR-161 (Evolu đã kết nối sẵn với NitiGroup và Preschool sau khi dựng)

## Plan
- `bun run tenant:connect -- --a <key> --b <key> [--dry-run] [--i-know-prod]` (`tools/scripts/src/tenant-connect.ts`) + `deploy/tenants/connect-all.sh`.
- Chạy thật: sau onboard-all của evolu, nitigroup, preschool, trong container `tool` (DATABASE_URL chủ migration).

| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Lõi `run` (hàm `cc_invite` + `partner_link_accept`) + guard prod | `tools/scripts/src/tenant-connect.ts` | [x] |
| 2 | int: hai chiều, chạy lại, thiếu Danh bạ/Toàn quyền, không đụng công ty khác | `tools/scripts/src/tenant-connect.int.test.ts` | [x] |
| 3 | `connect-all.sh` + lệnh `tenant:connect` + README prod/stg-test | `deploy/tenants/connect-all.sh`, `package.json`, README | [x] |

## Quyết định trong lúc làm
- Đi đúng hàm hub 0145 với người Toàn quyền thật (tra `hub.cc_owners_raw`, nhỏ nhất theo id); không INSERT thẳng bảng (G1).
- Chuông «muốn kết nối» / «đã đồng ý» phát như thường (đường chung, không thêm nhánh bỏ qua) — người Toàn quyền hai bên thấy kết nối đã có sẵn.
- Guard `--i-know-prod` dùng lại `isLocalDbHost` (cùng khuôn seed-community-demo).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/onboarding-cong-ty.md
#### Yêu cầu: Evolu được kết nối sẵn với NitiGroup và Preschool sau khi dựng (nguồn: tenant-connect)
- Kịch bản: chạy kết nối cho hai công ty đã bật Danh bạ ⇒ có kết nối hai chiều, không cần mời/đồng ý tay [test: tools/scripts/src/tenant-connect.int.test.ts » chạy thử không ghi, kết nối hai chiều, chạy lại already, công ty thứ ba không bị đụng]
- Kịch bản: chạy lại khi đã kết nối ⇒ báo already và không đổi gì [test: tools/scripts/src/tenant-connect.int.test.ts » chạy thử không ghi, kết nối hai chiều, chạy lại already, công ty thứ ba không bị đụng]
- Kịch bản: công ty chưa bật Danh bạ hoặc chưa có người Toàn quyền ⇒ báo lỗi rõ, không ghi [test: tools/scripts/src/tenant-connect.int.test.ts » thiếu Danh bạ, thiếu người Toàn quyền, thiếu công ty ⇒ báo lỗi rõ, không ghi]
- Kịch bản: ghi thật vào DB ngoài máy dev/test thiếu cờ xác nhận ⇒ từ chối [test: tools/scripts/src/tenant-connect.int.test.ts » guard prod: DB ngoài máy dev/test hoặc APP_ENV=production cần --i-know-prod]
