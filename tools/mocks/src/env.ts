// ADM-NFR-06, CHAT-AC-31 · env của mock (spec M0 §7, plan C1 §3.1). Vắng → mặc định; sai → lỗi nêu tên biến, không in giá trị.
import { FLOW_IDLE_S, RUN_EVENTS_RETENTION_S } from "@ai/contracts/chat";
import { z } from "zod";

const Port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);
const Seconds = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

const MockEnvSchema = z.object({
  DIFY_MOCK_PORT: Port(4010),
  HUB_MOCK_PORT: Port(4020),
  MOCK_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
  MOCK_FAST: z.enum(["0", "1"]).default("0"),
  MOCK_FLOW_IDLE_S: Seconds(FLOW_IDLE_S),
  MOCK_EVENTS_RETENTION_S: Seconds(RUN_EVENTS_RETENTION_S),
});

/** Version semver của `/health` khi mock chạy từ env (CHAT-AC-31, K-A6). */
export const MOCK_HUB_VERSION = "0.0.0-mock";

/** Phần env của mock chat; `createHubMock({timeoutMs})` kiểu M0 vẫn hợp lệ (mọi trường có mặc định). */
export type ChatMockEnv = {
  fast: boolean;
  flowIdleS: number;
  eventsRetentionS: number;
  healthVersion: string;
};

export type MockEnv = { difyPort: number; hubPort: number; timeoutMs: number } & ChatMockEnv;

export function loadMockEnv(source: Record<string, string | undefined>): MockEnv {
  // Chuỗi rỗng coi như vắng (dòng `KEY=` trong .env).
  const pick = (k: string) => (source[k] === "" ? undefined : source[k]);
  const keys = Object.keys(MockEnvSchema.shape) as (keyof typeof MockEnvSchema.shape)[];
  const r = MockEnvSchema.safeParse(Object.fromEntries(keys.map((k) => [k, pick(k)])));
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new Error(`Env mock không hợp lệ: ${names.join(", ")}`);
  }
  return {
    difyPort: r.data.DIFY_MOCK_PORT,
    hubPort: r.data.HUB_MOCK_PORT,
    timeoutMs: r.data.MOCK_TIMEOUT_MS,
    fast: r.data.MOCK_FAST === "1",
    flowIdleS: r.data.MOCK_FLOW_IDLE_S,
    eventsRetentionS: r.data.MOCK_EVENTS_RETENTION_S,
    healthVersion: MOCK_HUB_VERSION,
  };
}
