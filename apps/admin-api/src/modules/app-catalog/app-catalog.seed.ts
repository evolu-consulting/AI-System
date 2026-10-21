// app-catalog · khởi động admin-api: bảng rỗng ⇒ chèn 4 app mặc định; điền URL cho app còn rỗng từ env (APP_URL_*) ⇒ deploy đầu
// tiên giữ nguyên hành vi cũ (switcher/SSO thấy đúng các URL từng nhúng lúc build). Không đè giá trị admin đã sửa ở "Ứng dụng".
import { type Db, withScope } from "@ai/db";
import * as repo from "./app-catalog.repo";

/** Khớp seed của migration 0016 (bảng rỗng ⇒ dựng lại, vd DB test / môi trường vừa reset). */
export const DEFAULT_APPS: readonly repo.DefaultApp[] = [
  {
    key: "chat",
    name: { vi: "Chat AI", en: "AI Chat" },
    icon: "sparkles",
    audience: "all",
    requiredFeature: null,
    sso: true,
    sortOrder: 10,
  },
  {
    key: "contracts",
    name: { vi: "Sổ Hợp Tác", en: "Cooperation Ledger" },
    icon: "file-text",
    audience: "all",
    requiredFeature: "contracts-read",
    sso: true,
    sortOrder: 20,
  },
  {
    key: "studio",
    name: { vi: "Studio", en: "Studio" },
    icon: "wand",
    audience: "platform",
    requiredFeature: null,
    sso: false,
    sortOrder: 30,
  },
  {
    key: "admin",
    name: { vi: "Quản trị", en: "Admin" },
    icon: "settings",
    audience: "admin",
    requiredFeature: null,
    sso: true,
    sortOrder: 40,
  },
];

export type AppUrlEnv = {
  APP_URL_CHAT?: string;
  APP_URL_CONTRACTS?: string;
  APP_URL_STUDIO?: string;
  APP_URL_ADMIN?: string;
};

/** `key` catalog ↔ biến env; bỏ `/` cuối, bỏ giá trị rỗng. */
export function seedUrlsFromEnv(env: AppUrlEnv): Record<string, string> {
  const pairs: [string, string | undefined][] = [
    ["chat", env.APP_URL_CHAT],
    ["contracts", env.APP_URL_CONTRACTS],
    ["studio", env.APP_URL_STUDIO],
    ["admin", env.APP_URL_ADMIN],
  ];
  const out: Record<string, string> = {};
  for (const [k, v] of pairs) {
    const u = (v ?? "").trim().replace(/\/+$/, "");
    if (u) out[k] = u;
  }
  return out;
}

/** Trả số app vừa được điền URL. */
export async function seedAppUrls(db: Db, env: AppUrlEnv): Promise<number> {
  const urls = seedUrlsFromEnv(env);
  return withScope(db, { kind: "platform" }, (tx) => repo.seedDefaults(tx, DEFAULT_APPS, urls));
}
