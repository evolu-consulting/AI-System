import { tok, hub, putSource, getSource, setDef, ghCfg, EV, GH_URL, sql } from "./cfg2.mjs";
import { login } from "./api.mjs";
const t = await tok();
// khoá nguồn PAT (mock chấp nhận ghp-mock-ok)
let c = await hub(t, "GET", "/admin/source-credentials");
let cred = c.json.items?.find((x) => x.name === "uat-pat");
if (!cred) { c = await hub(t, "POST", "/admin/source-credentials", { name: "uat-pat", value: "ghp-mock-ok" }); console.log("cred", c.status, JSON.stringify(c.json)); cred = c.json; }
console.log("cred id", cred.id);
const ex = await getSource(t, "repo");
if (ex?.key) console.log("repo đã có v", ex.version);
else { const r = await hub(t, "POST", "/admin/sources", { key: "repo", kind: "git_remote", config: ghCfg({ credential_secret_id: cred.id, apply_mode: "pr" }), description: "UAT P-c2 repo GitHub (mock)" }); console.log("src", r.status, JSON.stringify(r.json).slice(0, 300)); }
const d = await setDef(t, { testCmd: "bun test #fake:apply=pushed" });
console.log("def", d.id, d.enabled);
