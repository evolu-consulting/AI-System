// `bun --env-file=.env.local tools/hub-dev/src/demo-packs.ts [adminUrl]`: bật Sổ Hợp Tác + Community cho tenant demo `evolu`
// và đưa user demo vào Group của gói (idempotent). `scripts/dev-up.ps1` gọi sau khi admin-api lên; không đổi hành vi `hub:dev`.
import { AUTH_URL } from "./dev";
import { DEMO_PACKS, ensureDemoPacks } from "./fixture";

await ensureDemoPacks(process.argv[2] || AUTH_URL);
console.log(`đã bật gói ${DEMO_PACKS.join(", ")} cho tenant demo`);
