// X1 ST1 · luật thuần `bun run combine:dev` (plan-stack.md "Kiểu", plan §3 env tổng hợp). Không import ngoài (depcruise `rules-must-be-pure`); token dùng Web Crypto toàn cục.
// Env trả về là phần GHI ĐÈ cho từng tiến trình (không chép `base`); `combine.ts` tự ghép với bản chụp `process.env`.
// `HUB_INTERNAL_TOKEN` chỉ có trong admin-api + hub-api (plan R2) — web/dify-mock không bao giờ nhận.

export type ProcName =
  | "admin-api"
  | "hub-api"
  | "dify-mock"
  | "chat-web"
  | "admin-web"
  | "studio-web";

export const START_ORDER: readonly ProcName[] = [
  "admin-api",
  "hub-api",
  "dify-mock",
  "chat-web",
  "admin-web",
  "studio-web",
];

export const PORTS = {
  "admin-api": 3001,
  "hub-api": 4000,
  "dify-mock": 5001,
  "chat-web": 3100,
  "admin-web": 3000,
  "studio-web": 3200,
} as const satisfies Record<ProcName, number>;

const url = (p: ProcName) => `http://localhost:${PORTS[p]}`;
export const URLS = {
  admin: url("admin-api"),
  hub: url("hub-api"),
  difyMock: url("dify-mock"),
  chatWeb: url("chat-web"),
  adminWeb: url("admin-web"),
  studioWeb: `${url("studio-web")}/studio/`,
} as const;

/** Origin 3 web dev (admin 3000, chat 3100, studio 3200). */
export const WEB_ORIGINS = [url("admin-web"), url("chat-web"), url("studio-web")] as const;

export type CombineOpts = { token?: string; wsl?: boolean; mock?: boolean };

/** Token nội bộ admin-api ↔ Hub: 36 byte ngẫu nhiên → 48 ký tự base64url. */
export function newInternalToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(36))).toString("base64url");
}

export function buildCombineEnv(
  base: Record<string, string | undefined>,
  opts: CombineOpts = {},
): Record<ProcName, Record<string, string>> {
  const token = opts.token?.trim() || base.HUB_INTERNAL_TOKEN?.trim() || newInternalToken();
  return {
    "admin-api": {
      PORT: String(PORTS["admin-api"]),
      CORS_ORIGINS: WEB_ORIGINS.join(","),
      ADMIN_HUB_URL: URLS.hub,
      HUB_INTERNAL_TOKEN: token,
    },
    "hub-api": {
      // Runtime không do hub-dev bật: in lệnh WSL (hoặc `COMBINE_WSL=1` tự chạy) — `hubApiEnv` ⇒ URL nội bộ localhost.
      HUB_DEV_RUNTIME: "none",
      HUB_CORS_ORIGINS: [url("chat-web"), url("admin-web"), url("studio-web")].join(","),
      HUB_INTERNAL_TOKEN: token,
    },
    "dify-mock": { PORT: String(PORTS["dify-mock"]) },
    "chat-web": { HUB_URL: URLS.hub, AUTH_URL: URLS.admin },
    "admin-web": {
      ADMIN_API_URL: URLS.admin,
      PUBLIC_HUB_URL: URLS.hub,
      PUBLIC_STUDIO_URL: URLS.studioWeb,
      PUBLIC_CHAT_WEB_URL: URLS.chatWeb,
    },
    "studio-web": {
      ADMIN_API_URL: URLS.admin,
      HUB_URL: URLS.hub,
      PUBLIC_ADMIN_WEB_URL: URLS.adminWeb,
      PUBLIC_CHAT_WEB_URL: URLS.chatWeb,
    },
  };
}

/** Thứ tự dừng = ngược thứ tự bật, chỉ gồm tên có trong `started` (tên lặp chỉ dừng một lần). */
export function stopOrder(started: readonly ProcName[]): ProcName[] {
  return [...new Set(started)].reverse();
}

/** Env web = bản chụp `base` (TRƯỚC khi gộp env admin/hub) bỏ `HUB_INTERNAL_TOKEN` (có thể đến từ `.env.local`) + phần ghi đè. */
export function webEnv(
  base: Record<string, string | undefined>,
  overlay: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base))
    if (v !== undefined && k !== "HUB_INTERNAL_TOKEN") out[k] = v;
  return { ...out, ...overlay };
}

/** `D:\AI\ai-system` → `/mnt/d/AI/ai-system`; đường dẫn POSIX giữ nguyên. */
export function toWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(p);
  if (!m) return p;
  return `/mnt/${(m[1] ?? "").toLowerCase()}/${(m[2] ?? "").replaceAll("\\", "/")}`.replace(
    /\/$/,
    "",
  );
}

/** Script bash cho Runtime trong WSL (hub-dev.md "Runtime trong WSL", provider `claude-sub,dify`; mirrored ⇒ localhost). */
export function wslRuntimeScript(repoWsl = "/mnt/d/AI/ai-system"): string {
  const env = [
    "UV_PROJECT_ENVIRONMENT=$HOME/.venvs/agent-runtime",
    "APP_ENV=development",
    "AGENT_RT_PROVIDERS=claude-sub,dify",
    `AGENT_RT_HUB_URL=${URLS.hub}`,
    "AGENT_RT_DATABASE_URL=postgres://agent_runtime:agent_runtime_dev_pw@localhost:5432/ai_system",
    "REDIS_URL=redis://localhost:6379",
    "AGENT_RT_WORKER_ID=combine",
    "AGENT_RT_WORK_DIR=$HOME/combine/work",
    "AGENT_RT_LOG_DIR=$HOME/combine/logs",
  ];
  return [
    `mkdir -p ~/combine/work ~/combine/logs && cd ${repoWsl}/apps/agent-runtime`,
    `export ${env.join(" ")}`,
    "exec uv run --frozen python -m agent_runtime",
    "",
  ].join("\n");
}
