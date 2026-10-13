// Tạo user `uat-outsider` (member evolu, KHÔNG thuộc phòng Evolu team) để kiểm quyền xem run/tải file. Dọn bằng cleanup.mjs.
import { login, hub, AUTH } from "./api.mjs";
const t = await login("evolu", "julian.bui");
let r = await hub(t.replace?.length ? t : t, "POST", "/x", {}).catch(() => null);
const res = await fetch(AUTH + "/admin/users", { method: "POST", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify({ username: "uat-outsider", display_name: "UAT Outsider", role: "member", locale: "vi" }) });
const j = await res.json(); console.log(res.status, JSON.stringify(j).slice(0, 300));
if (res.status === 201) {
  const lg = await (await fetch(AUTH + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: "evolu", username: "uat-outsider", password: j.temp_password }) })).json();
  console.log(Object.keys(lg));
  const ch = await fetch(AUTH + "/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change_token: lg.change_token, new_password: "1234567890" }) });
  console.log("change", ch.status, (await ch.text()).slice(0, 100));
}
