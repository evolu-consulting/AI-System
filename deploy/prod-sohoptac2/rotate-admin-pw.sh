#!/usr/bin/env bash
# Đổi mật khẩu platform admin (tài khoản trong ADMIN_CREDENTIALS.txt): mật khẩu mới sinh NGẪU NHIÊN trên máy chủ, đổi qua
# POST /auth/change-password (tự đổi: current_password + new_password), rồi ghi lại ADMIN_CREDENTIALS.txt (600) và thử đăng nhập lại.
# KHÔNG in mật khẩu cũ/mới; truyền vào container qua biến môi trường (không nằm trên dòng lệnh). Chạy: bash rotate-admin-pw.sh
set -euo pipefail
cd "$(dirname "$0")"
F=ADMIN_CREDENTIALS.txt
[ -f "$F" ] || { echo "rotate: thieu $F"; exit 1; }
OLD_PW="$(sed -n 's/^password: //p' "$F")"
ADMIN_USER="$(sed -n 's/^username: //p' "$F")"
NEW_PW="$(head -c 512 /dev/urandom | tr -dc 'A-Za-z0-9' | cut -c1-24)"
[ "${#NEW_PW}" -eq 24 ] || { echo "rotate: sinh mat khau loi"; exit 1; }
export OLD_PW NEW_PW ADMIN_USER

# $1 = "change" | "check"
call() {
  MODE="$1" docker compose -p sohoptac2 exec -T -e OLD_PW -e NEW_PW -e ADMIN_USER -e MODE admin-api bun -e '
    const b = "http://127.0.0.1:" + (process.env.PORT || "3001");
    const h = { "content-type": "application/json", "x-client": "extension" };
    const pw = process.env.MODE === "check" ? process.env.NEW_PW : process.env.OLD_PW;
    const r = await fetch(b + "/auth/login", { method: "POST", headers: h,
      body: JSON.stringify({ tenant_key: "platform", username: process.env.ADMIN_USER, password: pw }) });
    const j = await r.json().catch(() => ({}));
    if (!j.access_token) { console.log("login", r.status, j.status ?? j.error?.code ?? ""); process.exit(1); }
    if (process.env.MODE === "check") { console.log("login moi OK"); process.exit(0); }
    const c = await fetch(b + "/auth/change-password", { method: "POST",
      headers: { ...h, authorization: "Bearer " + j.access_token },
      body: JSON.stringify({ current_password: process.env.OLD_PW, new_password: process.env.NEW_PW }) });
    const e = c.ok ? "" : ((await c.json().catch(() => ({}))).error?.code ?? "");
    console.log("change-password", c.status, e);
    process.exit(c.ok ? 0 : 1);
  '
}

call change
umask 077
TMP="$(mktemp "$F.XXXX")"
sed "s/^password: .*/password: ${NEW_PW}/" "$F" > "$TMP"
chmod 600 "$TMP" && mv "$TMP" "$F"
unset OLD_PW
call check
unset NEW_PW
echo "rotate: da doi mat khau ${ADMIN_USER} (moi o $F, 600)"
