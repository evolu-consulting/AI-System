// Tạo tenant UAT thứ hai `uatb` (admin `uat.badmin`, mật khẩu 1234567890) để kiểm cách ly tenant.
import { AUTH, login } from "./api.mjs";
const t = await login("platform", "admin");
const H = { authorization: "Bearer " + t, "content-type": "application/json" };
let r = await fetch(AUTH + "/admin/tenants?q=uatb&limit=50", { headers: H }); let j = await r.json();
if (j.items.find((x) => x.key === "uatb")) { console.log("đã có"); process.exit(0); }
r = await fetch(AUTH + "/admin/tenants", { method: "POST", headers: H, body: JSON.stringify({ key: "uatb", name: "UAT B", first_admin: { username: "uat.badmin", display_name: "UAT B Admin", email: "uat.badmin@uatb.local" } }) });
j = await r.json(); console.log(r.status, Object.keys(j));
const temp = j.temp_password ?? j.first_admin?.temp_password ?? j.user?.temp_password; console.log("temp?", !!temp);
const lg = await (await fetch(AUTH + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: "uatb", username: "uat.badmin", password: temp }) })).json();
const ch = await fetch(AUTH + "/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change_token: lg.change_token, new_password: "1234567890" }) });
console.log("change", ch.status);
