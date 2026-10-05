// HUB-FR-44 · WRK-FR-11 · helper test hàm thuần H2c (test-plan §1, cases §1): byte mẫu, uid, đếm byte, nạp hàm còn thiếu
// stub. Chỉ dữ liệu, không I/O.

import type {
  AgentConfig,
  ProfileConfig,
} from "../../../../apps/hub-api/src/modules/config/config.rules";
import type { PayloadInput } from "../../../../apps/hub-api/src/modules/runner/runner.rules";

/** Dải uuid cố định H2c rules (`a2c0…`). */
export const uid = (n: number): string => `a2c00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const MIB = 1_048_576;

/** Số byte UTF-8. */
export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** Byte từ hex có cách (`"89 50 4E 47"`). */
export const hex = (h: string): Uint8Array =>
  Uint8Array.from(
    h
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((b) => Number.parseInt(b, 16)),
  );
/** Byte UTF-8 của chuỗi. */
export const u8 = (s: string): Uint8Array => new TextEncoder().encode(s);
export const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
/** Đệm byte `fill` tới `n` byte. */
export const pad = (b: Uint8Array, n: number, fill = 0x41): Uint8Array =>
  b.length >= n ? b : cat(b, new Uint8Array(n - b.length).fill(fill));

export const SIG = {
  pdf: u8("%PDF-1.7\n%âãÏÓ\n1 0 obj"),
  png: hex("89 50 4E 47 0D 0A 1A 0A 00 00 00 0D 49 48 44 52"),
  jpg: hex("FF D8 FF E0 00 10 4A 46 49 46 00 01 01 00 00 01"),
  zip: cat(hex("50 4B 03 04"), pad(new Uint8Array(), 12, 0x14)),
  mz: pad(u8("MZ"), 16, 0x90),
  elf: cat(hex("7F 45 4C 46 02 01 01 00"), new Uint8Array(8)),
  shebang: u8("#!/bin/sh\necho hi\n"),
  bom: hex("EF BB BF"),
} as const;

/**
 * Hàm plan-rules mà stub B0 chưa khai báo (báo backend-lead): gọi qua module namespace để test vẫn biên dịch; vắng →
 * ném lỗi nêu rõ stub thiếu (đỏ đúng lý do "chưa có hàm", không đỏ vì import).
 */
export function lookup<F extends (...a: never[]) => unknown>(
  mod: object,
  name: string,
  where: string,
): F {
  return ((...a: never[]) => {
    const f = (mod as Record<string, unknown>)[name];
    if (typeof f !== "function")
      throw new Error(`not implemented: ${name} (stub thiếu ở ${where})`);
    return f(...a);
  }) as F;
}

const AGENT: AgentConfig = {
  id: uid(1),
  key: "hoadon",
  name: { vi: "Hoá đơn", en: "Invoice" },
  description: "Đọc hoá đơn",
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: uid(9),
  systemPrompt: "SP",
  runtimeOptions: {},
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
};
const PROFILE: ProfileConfig = {
  id: uid(9),
  key: "fake-1",
  steps: [{ provider_key: "fake-cli", model: null, on: ["quota"] }],
};

/** Đầu vào `buildJobPayload` job agent hợp lệ (H2b, không file). */
export const payloadInput = (o: Partial<PayloadInput> = {}): PayloadInput => ({
  jobId: uid(2),
  stepId: uid(3),
  run: { id: uid(4), tenantId: uid(5), userId: uid(6), conversationId: uid(7), flowId: uid(8) },
  agent: AGENT,
  role: "agent",
  profile: PROFILE,
  prompt: "Đọc hoá đơn",
  systemPrompt: "SP",
  history: [{ role: "user", content: "trước" }],
  ...o,
});
export const agentWith = (o: Partial<AgentConfig>): AgentConfig => ({ ...AGENT, ...o });

/** Ký tự theo code point — tránh để ký tự vô hình/bidi/tổ hợp dạng thô trong source (biome bỏ escape `\u`). */
export const ch = (...codes: number[]): string => String.fromCodePoint(...codes);
