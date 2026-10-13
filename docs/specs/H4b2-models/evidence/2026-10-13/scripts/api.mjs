// Helper gọi API Studio bằng token platform_admin (chuẩn bị/dọn dữ liệu, kiểm chứng DB qua API — không thay UAT UI)
export const AUTH = "http://localhost:3001", HUB = "http://localhost:4000";
export async function token(user = "admin", tenant = "platform", pw = "1234567890") {
  const r = await fetch(`${AUTH}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_key: tenant, username: user, password: pw }) });
  return (await r.json()).access_token;
}
export async function api(tok, method, path, body) {
  const r = await fetch(`${HUB}/studio/api${path}`, { method, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
