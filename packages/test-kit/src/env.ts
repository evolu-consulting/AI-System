// TK1 · URL DB test (owner / admin_api / hub_api) và id tất định. Không tạo kết nối.
export const withCreds = (url: string, user: string, password: string): string => {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
};

const need = (name: string): string => {
  const v = process.env[name];
  if (!v)
    throw new Error(
      `${name} chưa đặt — chạy qua \`bun run test:int\` / \`test:int:par\` (env .env.local)`,
    );
  return v;
};

/** URL theo env hiện tại (đọc lười: import kit không ném khi chỉ chạy unit). */
export const urls = (): { owner: string; adminApi: string; hubApi: string } => {
  const owner = need("TEST_DATABASE_URL");
  return {
    owner,
    adminApi:
      process.env.TEST_ADMIN_API_DATABASE_URL ?? withCreds(owner, "admin_api", "admin_api_dev_pw"),
    hubApi: process.env.TEST_HUB_API_DATABASE_URL ?? withCreds(owner, "hub_api", "hub_api_dev_pw"),
  };
};

/** UUID tất định `tk<ns>-…-<n>`: ns (0–255) tách miền giữa các lát, n tăng dần. */
export const uuidOf = (ns: number, n: number): string =>
  `7e5d${ns.toString(16).padStart(4, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
