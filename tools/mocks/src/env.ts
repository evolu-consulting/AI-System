// ADM-NFR-06 · env của mock (spec M0 §7). Vắng → mặc định; sai → lỗi nêu tên biến, không in giá trị.
import { z } from "zod";

const Port = (fallback: number) => z.coerce.number().int().min(1).max(65535).default(fallback);

const MockEnvSchema = z.object({
  DIFY_MOCK_PORT: Port(4010),
  HUB_MOCK_PORT: Port(4020),
  MOCK_TIMEOUT_MS: z.coerce.number().int().min(0).default(30000),
});

export type MockEnv = { difyPort: number; hubPort: number; timeoutMs: number };

export function loadMockEnv(source: Record<string, string | undefined>): MockEnv {
  // Chuỗi rỗng coi như vắng (dòng `KEY=` trong .env).
  const pick = (k: string) => (source[k] === "" ? undefined : source[k]);
  const r = MockEnvSchema.safeParse({
    DIFY_MOCK_PORT: pick("DIFY_MOCK_PORT"),
    HUB_MOCK_PORT: pick("HUB_MOCK_PORT"),
    MOCK_TIMEOUT_MS: pick("MOCK_TIMEOUT_MS"),
  });
  if (!r.success) {
    const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
    throw new Error(`Env mock không hợp lệ: ${names.join(", ")}`);
  }
  return {
    difyPort: r.data.DIFY_MOCK_PORT,
    hubPort: r.data.HUB_MOCK_PORT,
    timeoutMs: r.data.MOCK_TIMEOUT_MS,
  };
}
