// Dọn dữ liệu thử UAT H4b-2 (profile, provider, secret, provider_state, job lịch sử giả)
import { token, api } from "./api.mjs";
import { sql } from "./sql.mjs";
const t = await token();
sql("delete from hub.jobs where provider_key like 'uat-%'");
for (const p of (await api(t, "GET", "/model-profiles")).body.items.filter((p) => p.key.startsWith("uat-"))) console.log("profile", p.key, (await api(t, "DELETE", `/model-profiles/${p.id}?version=${p.version}`)).status);
for (const p of (await api(t, "GET", "/providers")).body.items.filter((p) => p.key.startsWith("uat-"))) console.log("provider", p.key, (await api(t, "DELETE", `/providers/${p.id}?version=${p.version}`)).status);
sql("delete from hub.provider_state where provider_key like 'uat-%'");
for (const s of (await api(t, "GET", "/secrets?q=uat-")).body.items) console.log("secret", s.name, (await api(t, "DELETE", `/secrets/${s.id}?version=${s.version}`)).status);
