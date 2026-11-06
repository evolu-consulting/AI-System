// CR-122 · A2b · chạy `fn` dưới role gói + tenant NGAY TRONG tx đang mở (tx engine). Cài đặt nằm ở `@ai/db/pack-scope`
// (luật review m-01: chỉ *-scope.ts của packages/db được set_config role/app.tenant_id); kit chỉ re-export.
export { withPackRoleInTx } from "@ai/db/pack-scope";
