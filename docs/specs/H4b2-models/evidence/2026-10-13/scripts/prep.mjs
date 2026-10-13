import { token, api } from "./api.mjs";
const t = await token();
for (const [name, value] of [["uat-fake-ok", "fake-ok-uat-123456"], ["uat-fake-bad", "fake-bad-uat-123456"]]) {
  const r = await api(t, "POST", "/secrets", { kind: "provider_api_key", name, value });
  console.log(name, r.status, r.body?.error?.code ?? "");
}
for (const p of ["providers", "model-profiles", "agent-entitlements"]) { const r = await api(t, "GET", `/${p}`); console.log(p, r.status, JSON.stringify(r.body).slice(0, 1500)); }
