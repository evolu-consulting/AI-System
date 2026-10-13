// HUB-FR-67 · review H4b-2 vòng 2 #3 · nhánh savepoint khi xoá profile gặp FK 23503 (agent mới gắn giữa chừng):
// còn agent ⇒ PROFILE_IN_USE{agents}; rỗng ⇒ VERSION_CONFLICT kèm bản hiện tại. Tx giả (không DB); DB thật ở int.
import { describe, expect, it } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { AuthUser } from "../../../lib/auth.middleware";
import { ProfilesService } from "./profiles.service";

const dialect = new PgDialect();
const ID = "a4b20000-0000-4000-8000-000000000001";
const UPDATED = new Date("2026-10-13T00:00:00Z");
const row = {
  id: ID,
  key: "qc-a",
  steps: [{ provider_key: "fake-cli", model: null, on: [] }],
  version: 3,
  updatedAt: UPDATED,
};
const actor = { userId: "u1", role: "platform_admin" } as unknown as AuthUser;

/** `selects`: kết quả lần lượt của từng `tx.select(...)` (builder chuỗi, await ra mảng). `savepointErr` ném từ savepoint. */
function fakeDb(selects: unknown[][], savepointErr: unknown) {
  const queue = [...selects];
  const tx = {
    execute: async (q: SQL) =>
      dialect.sqlToQuery(q).sql.includes("config_meta") ? [{ v: 5 }] : [],
    select: () => {
      const rows = queue.shift() ?? [];
      const chain: Record<string, unknown> = {
        // biome-ignore lint/suspicious/noThenProperty: builder Drizzle là thenable
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(res, rej),
      };
      for (const m of ["from", "where", "orderBy", "limit", "groupBy", "leftJoin", "for"])
        chain[m] = () => chain;
      return chain;
    },
    transaction: async () => {
      throw savepointErr;
    },
  };
  return { db: { db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) } } as never, queue };
}

const fkErr = { code: "23503" };
const svc = (selects: unknown[][], err: unknown = fkErr) =>
  new ProfilesService({ db: fakeDb(selects, err).db, audit: {} as never });

describe("ProfilesService.remove · savepoint 23503", () => {
  it("còn agent sau khi đọc lại ⇒ PROFILE_IN_USE{agents}", async () => {
    const agents = [{ id: "g1", key: "hoadon" }];
    // readProfile(lock) · agentsUsing (trước) = rỗng · agentsUsing (đọc lại) = còn agent
    const p = svc([[row], [], agents]).remove(actor, ID, 3);
    await expect(p).rejects.toMatchObject({
      code: "PROFILE_IN_USE",
      status: 409,
      details: { agents },
    });
  });

  it("rỗng sau khi đọc lại ⇒ VERSION_CONFLICT{current, updated_at}", async () => {
    // lock · agentsUsing · đọc lại rỗng · profileDetail: readProfile · providers · agentCounts · agentsUsing
    const p = svc([[row], [], [], [row], [], [], []]).remove(actor, ID, 3);
    await expect(p).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      details: { updated_at: UPDATED.toISOString(), current: { id: ID, key: "qc-a", version: 3 } },
    });
  });

  it("lỗi không phải 23503 ⇒ ném nguyên", async () => {
    const boom = new Error("boom");
    await expect(svc([[row], []], boom).remove(actor, ID, 3)).rejects.toBe(boom);
  });
});
