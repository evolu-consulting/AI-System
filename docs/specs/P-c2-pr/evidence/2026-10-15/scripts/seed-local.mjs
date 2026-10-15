import { login, hub } from "./api.mjs";
import { EV } from "./cfg2.mjs";
const p = await login("platform", "admin");
let r = await hub(p, "POST", "/admin/sources", { key: "repo-local", kind: "local_path", config: { kind: "local_path", path: "/work/.data/uat-pc2-local" }, description: "UAT P-c2 nguồn thư mục cục bộ (luôn Chỉ nhánh)", tenant_id: EV });
console.log(r.status, JSON.stringify(r.json).slice(0, 300));
r = await hub(p, "POST", "/admin/sources/repo-local/check?tenant_id=" + EV, {}); console.log("check", r.status, JSON.stringify(r.json).slice(0, 200));
