// `bun --env-file=.env.local tools/hub-dev/src/demo-packs.ts [--tenant demo]`: bật Sổ Hợp Tác + Community và đưa user vào Group
// của gói (idempotent). Mặc định tenant `evolu` (user demo của hub:dev); `--tenant demo` ⇒ `demo-owner` làm chủ gói (tenant do
// `seed-community-demo --dev-fixture` tạo). `scripts/dev-up.ps1` gọi sau khi admin-api lên; không đổi hành vi `hub:dev`.
import { parseArgs } from "node:util";
import { AUTH_URL } from "./dev";
import { DEMO_PACKS, ensureDemoPacks, ensureTenantPacks } from "./fixture";

const { values } = parseArgs({
  options: { tenant: { type: "string" }, admin: { type: "string" } },
});
const adminUrl = values.admin || AUTH_URL;
if (values.tenant === "demo")
  await ensureTenantPacks(adminUrl, { tenantKey: "demo", owners: ["demo-owner"], editors: [] });
else if (!values.tenant || values.tenant === "evolu") await ensureDemoPacks(adminUrl);
else throw new Error(`demo-packs: chỉ hỗ trợ tenant evolu | demo (nhận ${values.tenant})`);
console.log(`đã bật gói ${DEMO_PACKS.join(", ")} cho tenant ${values.tenant ?? "evolu"}`);
