// ADM-FR-53 · helper cho các file notify-* và concurrency (test-plan §1 "kỹ thuật sentinel"). Không chứa `it(...)`.
import { type ConfigChangedPayload, ConfigChangedPayloadSchema } from "@ai/contracts";
import postgres from "postgres";
import { OWNER_URL } from "../M1/_fixtures";
import { num } from "./_data";
import type { Listener, M3Env, Msg, Res } from "./_fixtures";

export type Tracked = { res: Res; v0: number; v1: number; msgs: Msg[] };

/**
 * Chạy `run` rồi trả: `v0`/`v1` = config_version trước/sau (đọc ngay quanh `run`, trước sentinel) và `msgs` = các thông
 * điệp NOTIFY tới listener giữa hai mốc (chờ sentinel để biết "không còn gì tới nữa", không dùng sleep).
 */
export async function track(env: M3Env, lis: Listener, run: () => Promise<Res>): Promise<Tracked> {
  const v0 = await env.cfg();
  const from = lis.msgs.length;
  const res = await run();
  const v1 = await env.cfg();
  const msgs = await env.settle(lis, from);
  return { res, v0, v1, msgs };
}

/** `version` hiện tại của một hàng (owner), để dựng body PATCH. */
export const verOf = (env: M3Env, table: string, id: string) =>
  num(env.owner, `select version::int as n from admin.${table} where id = '${id}'`);

export type Probe<T> = {
  results: Array<{ at: number; payload: ConfigChangedPayload; result: T }>;
  /** Chờ tới khi có ít nhất `n` kết quả, quá `ms` (mặc định 1000) → ném. Thăm dò theo điều kiện, có hạn chót. */
  wait: (n: number, ms?: number) => Promise<void>;
  close: () => Promise<void>;
};

/**
 * Listener `LISTEN config_changed` có callback chạy `check` NGAY khi nhận thông điệp (đóng vai Hub đọc DB lúc nhận).
 * Dùng để chứng minh: tại lúc NOTIFY tới, dữ liệu đã commit và đã đọc được (NOTIFY gửi SAU commit).
 */
export async function onNotify<T>(
  check: (p: ConfigChangedPayload) => Promise<T>,
): Promise<Probe<T>> {
  const sql = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
  const results: Probe<T>["results"] = [];
  const waiters: Array<() => void> = [];
  await sql.listen("config_changed", async (raw) => {
    const at = performance.now();
    const payload = ConfigChangedPayloadSchema.parse(JSON.parse(raw));
    results.push({ at, payload, result: await check(payload) });
    for (const w of waiters.splice(0)) w();
  });
  return {
    results,
    wait: async (n, ms = 1000) => {
      const end = performance.now() + ms;
      while (results.length < n) {
        const left = end - performance.now();
        if (left <= 0)
          throw new Error(`NOTIFY: chờ ${n} kết quả, chỉ có ${results.length} sau ${ms} ms`);
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, left);
          waiters.push(() => {
            clearTimeout(t);
            resolve();
          });
        });
      }
    },
    close: async () => {
      await sql.end({ timeout: 1 });
    },
  };
}
