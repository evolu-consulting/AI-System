// X2b review-2 #N2 · lùi cấp số nhân của vòng bù (review-1 #5): run lỗi bị loại khỏi lượt sau tới hết hạn lùi.
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "../../../lib/db";
import type { Logger } from "../../../lib/logger";
import { RoomRunPoster } from "./room-post";

const RUN = "a2bb0000-0000-4000-8000-000000000001";
const dialect = new PgDialect();

/** DB giả: `unpostedRuns` trả `RUN` trừ khi nó nằm trong `skip`; ghi lại tham số các truy vấn đó. */
function fakeDb(): { db: Db; skips: unknown[][] } {
  const skips: unknown[][] = [];
  const tx = {
    execute: async (q: SQL) => {
      const { sql, params } = dialect.sqlToQuery(q);
      if (!sql.includes("room_posted_at is null")) return [];
      skips.push(params);
      return params.includes(`{${RUN}}`) ? [] : [{ id: RUN }];
    },
  };
  const db = { db: { transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
  return { db: db as unknown as Db, skips };
}

/** `post` luôn ném (giả lỗi đăng). */
class FailingPoster extends RoomRunPoster {
  override async post(): Promise<null> {
    throw new Error("boom");
  }
}

const warns: { msg: string; f?: Record<string, unknown> }[] = [];
const log = {
  warn: (msg: string, f?: Record<string, unknown>) => warns.push({ msg, f }),
  error: () => {},
  info: () => {},
  debug: () => {},
} as unknown as Logger;

afterEach(() => {
  warns.length = 0;
});

describe("RoomRunPoster.reconcile · lùi khi lỗi", () => {
  it("lỗi ⇒ bị loại ở lượt kế; hết hạn lùi ⇒ thử lại, lần 2 lùi lâu hơn", async () => {
    const { db, skips } = fakeDb();
    const p = new FailingPoster({ db, log });
    let now = 1_000_000;
    const clock = spyOn(Date, "now").mockImplementation(() => now);
    try {
      expect(await p.reconcile()).toBe(0);
      expect(warns.at(-1)?.f?.attempts).toBe(1);
      expect(skips.at(-1)).not.toContain(`{${RUN}}`);

      await p.reconcile();
      expect(skips.at(-1)).toContain(`{${RUN}}`);

      now += 10_001; // lần 1 lùi 10 s
      await p.reconcile();
      expect(skips.at(-1)).not.toContain(`{${RUN}}`);
      expect(warns.at(-1)?.f?.attempts).toBe(2);

      now += 10_001; // lần 2 lùi 20 s ⇒ vẫn bị loại
      await p.reconcile();
      expect(skips.at(-1)).toContain(`{${RUN}}`);
      expect(warns.filter((w) => w.msg === "room-post-reconcile-run-failed")).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });
});
