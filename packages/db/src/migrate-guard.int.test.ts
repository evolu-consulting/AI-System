// fix-migrate-guard · runner fail cứng khi bảng theo dõi có migration lạ cùng `when` (sự cố prod 2026-10-30: 0064_agent_hooks
// vs 0064_ops_watch cùng 1798900000000 ⇒ Drizzle bỏ qua 0064_ops_watch im lặng). DB worker đã migrate đủ từ mẫu.
import { afterAll, describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { runMigrations } from "./migrate";
import { readJournal } from "./migrate-guard";
import { runHubMigrations } from "./migrate-hub";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const sql = postgres(URL, { max: 1, onnotice: () => {} });
afterAll(() => sql.end());

const FOREIGN = "f".repeat(64);
const last = readJournal(
  fileURLToPath(new globalThis.URL("../migrations-hub", import.meta.url)),
).at(-1);

describe("fix-migrate-guard · runHubMigrations chặn lệch journal (int)", () => {
  test("DB khớp journal ⇒ chạy bình thường (0 migration mới); dòng lạ cùng `when` ⇒ ném lỗi nêu dòng, không áp gì", async () => {
    // DB worker có thể vừa bị reset bởi file trước trong lô ⇒ lượt 1 đưa về đủ, lượt 2 phải {0, 0} (guard không chặn đường thường).
    await runMigrations({ url: URL, appEnv: "test" });
    await runHubMigrations({ url: URL, appEnv: "test" });
    expect(await runHubMigrations({ url: URL, appEnv: "test" })).toEqual({ hub: 0, hubDev: 0 });
    await sql`insert into drizzle.__drizzle_migrations_hub (hash, created_at) values (${FOREIGN}, ${last?.when ?? 0})`;
    try {
      const err = await runHubMigrations({ url: URL, appEnv: "test" }).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(err).toContain("migrate-guard drizzle.__drizzle_migrations_hub");
      expect(err).toContain(`created_at=${last?.when} hash=${FOREIGN.slice(0, 16)}`);
    } finally {
      await sql`delete from drizzle.__drizzle_migrations_hub where hash = ${FOREIGN}`;
    }
  });
});
