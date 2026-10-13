// Kịch bản 1b — luật def phía server (PUT /process-defs/:id) bằng API, token julian.bui (không qua UI vì client chặn trước)
import { login, hub } from "./api.mjs";
import { writeFileSync } from "node:fs";
const EV="01a11c1d-ca4e-7000-b4eb-212defbb548f";
const t = await login("evolu", "julian.bui"), p = await login("platform", "admin");
const list = (await hub(t, "GET", "/process-defs?include_templates=false&limit=100")).json.items;
const it = list.find((d) => d.key === "fixbug-apply");
const def = (await hub(t, "GET", "/process-defs/" + it.id)).json;
const teamId = (await hub(t, "GET", "/agents?limit=100")).json;
const out = [];
const put = async (name, mut) => {
  const b = structuredClone(def); mut(b);
  for (const k of ["id","tenant_id","is_template","source_template_id","created_at","updated_at"]) delete b[k];
  const r = await hub(t, "PUT", "/process-defs/" + it.id, b);
  const rules = r.json?.error?.details?.rules ?? r.json?.error?.rules;
  out.push({ name, status: r.status, code: r.json?.error?.code, rules, details: JSON.stringify(r.json?.error?.details ?? null).slice(0, 300) });
  console.log(name, r.status, r.json?.error?.code, JSON.stringify(r.json?.error?.details ?? "").slice(0, 200));
};
const base = def.stages[0];
await put("executor-not-agent", (b) => { b.stages[0].executor = { kind: "team", team_id: "00000000-0000-4000-8000-000000000001" }; });
await put("after-not-review", (b) => { b.stages[0].after = { kind: "auto" }; });
await put("two-autofix", (b) => { const s2 = structuredClone(base); s2.key = "fix2"; s2.name = "Sửa 2"; b.stages.push(s2); });
await put("source-not-in-def", (b) => { b.stages[0].autofix.source_key = "khong-co"; });
await put("test-cmd-empty", (b) => { b.stages[0].autofix.test_cmd = ""; });
await put("allow-21", (b) => { b.stages[0].autofix.write_allowlist = Array.from({ length: 21 }, (_, i) => `d${i}/**`); });
await put("extra-field", (b) => { b.stages[0].autofix.network = true; });
writeFileSync("../api-def-rules.json", JSON.stringify(out, null, 2));
