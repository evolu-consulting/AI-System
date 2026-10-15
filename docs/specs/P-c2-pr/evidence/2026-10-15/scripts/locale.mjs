import { AUTH, login } from "./api.mjs";
const [tenant, user, loc] = process.argv.slice(2);
const t = await login(tenant, user);
const r = await fetch(AUTH + "/auth/me", { method: "PATCH", headers: { authorization: "Bearer " + t, "content-type": "application/json" }, body: JSON.stringify({ locale: loc }) });
console.log(tenant, user, loc, r.status);
