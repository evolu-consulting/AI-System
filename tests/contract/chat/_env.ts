// CHAT-AC-31, CHAT-AC-32 · đích của bộ test contract chat (plan C1 §4.1, test-plan §2).
// `HUB_URL` trống → dựng mock Hub trong tiến trình (`MOCK_FAST=1`); có → gọi đích đó (mock ngoài hoặc Hub thật).
// `AUTH_URL` trống → `HUB_URL`. Ca chỉ-mock dùng `describe.if(isMock)`; `isMock` = mock trong tiến trình
// hoặc `GET /__mock/ping` trả 204 (Hub thật không có route này).
import { loadMockEnv } from "../../../tools/mocks/src/env";
import { createHubMock } from "../../../tools/mocks/src/hub";

export type ContractUser = { tenant_key: string; username: string; password: string };
export type ContractUsers = {
  /** user A (`lan`): chủ dữ liệu của ca. */
  a: ContractUser;
  /** user B (`hoa`): cùng tenant với A. */
  b: ContractUser;
  /** user C (`an`): khác tenant. */
  other_tenant: ContractUser;
  /** user bị khoá (`khoa`). */
  locked: ContractUser;
  /** user có seed (`minh`, plan §3.5) — chỉ mock dùng. */
  seeded: ContractUser;
};

/** Mật khẩu dev chung của mock (plan §3.4); không phải secret. */
const DEV_PASSWORD = "dev-password-1";
const mockUser = (tenant_key: string, username: string): ContractUser => ({
  tenant_key,
  username,
  password: DEV_PASSWORD,
});

const DEFAULT_USERS: ContractUsers = {
  a: mockUser("acme", "lan"),
  b: mockUser("acme", "hoa"),
  other_tenant: mockUser("beta", "an"),
  locked: mockUser("acme", "khoa"),
  seeded: mockUser("acme", "minh"),
};

function readUsers(): ContractUsers {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: biến chỉ của test contract, không ảnh hưởng cache turbo
  const raw = process.env.CHAT_CONTRACT_USERS;
  if (!raw) return DEFAULT_USERS;
  const parsed = JSON.parse(raw) as Partial<ContractUsers>;
  return { ...DEFAULT_USERS, ...parsed };
}

/**
 * Dựng mock Hub trong tiến trình, cổng ngẫu nhiên. `extra` là env mock bổ sung
 * (vd `MOCK_EVENTS_RETENTION_S`, spec §9 M4). Trước B2 `loadMockEnv` bỏ qua biến chưa biết.
 */
export function startInProcessMock(extra: Record<string, string> = {}): {
  url: string;
  stop: () => void;
} {
  const env = loadMockEnv({ MOCK_FAST: "1", ...extra });
  const server = Bun.serve({ port: 0, idleTimeout: 0, fetch: createHubMock(env).fetch });
  return { url: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến chỉ của test contract, không ảnh hưởng cache turbo
const envHub = process.env.HUB_URL?.trim() ?? "";

/** true khi bộ test tự dựng mock (không có `HUB_URL`): được dựng thêm mock với env riêng (K-R6). */
export const inProcess = envHub === "";
export const HUB_URL = inProcess ? startInProcessMock().url : envHub.replace(/\/+$/, "");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến chỉ của test contract, không ảnh hưởng cache turbo
export const AUTH_URL = (process.env.AUTH_URL?.trim() || HUB_URL).replace(/\/+$/, "");
export const USERS = readUsers();

async function pingMock(): Promise<boolean> {
  try {
    const res = await fetch(`${HUB_URL}/__mock/ping`);
    await res.body?.cancel();
    return res.status === 204;
  } catch {
    return false;
  }
}

/** Đích là mock: bật ca chỉ-mock (seed `minh`, `#scn:`, `/__mock/*`). */
export const isMock = inProcess || (await pingMock());
