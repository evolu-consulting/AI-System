// Nguồn git_remote công khai nhỏ để kiểm "SHA ghim" (pin_sha) — chỉ đọc qua mạng, không secret.
import { login, hub } from "./api.mjs";
const p = await login("platform", "admin");
let r = await hub(p, "POST", "/admin/sources", { key: "uat-gh", kind: "git_remote", config: { kind: "git_remote", url: "https://github.com/octocat/Hello-World", branch: "master" }, description: "uat- repo công khai (kiểm SHA ghim)", tenant_id: "01a11c1d-ca4e-7000-b4eb-212defbb548f" });
console.log(r.status, JSON.stringify(r.json).slice(0, 200));
r = await hub(p, "POST", "/admin/sources/uat-gh/check?tenant_id=01a11c1d-ca4e-7000-b4eb-212defbb548f", {});
console.log("check", r.status, JSON.stringify(r.json).slice(0, 300));
