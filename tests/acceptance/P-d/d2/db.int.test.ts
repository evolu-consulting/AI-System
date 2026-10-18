// HUB-FR-146/147 · plan-db §3 (migration hub 0037) · test-plan-d2 §3.5 PD2-I50 (T15b): CHECK nới cho P-d2. Kiểm định nghĩa
// CHECK (pg_get_constraintdef) chứa giá trị mới + giữ giá trị cũ — chèn hàng thật cần fixture run/stage đầy đủ, phần chạy đã
// phủ ở tool/branch int (Tranh chấp T15b-3). Migrate 2 lần: H1 A49 (`runMigrations` gọi lại = 0). Thiếu 0037/0012 ⇒ đỏ NGAY ở `needD2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxD2, needD2, startD2 } from "./_d2";

let c: CtxD2;
beforeAll(async () => {
  c = await startD2();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** Mọi định nghĩa CHECK của bảng `hub.<table>` (gộp một chuỗi). */
async function checks(table: string): Promise<string> {
  const rows = await c.sql<{ d: string }[]>`select pg_get_constraintdef(oid) as d from pg_constraint
    where conrelid = ${`hub.${table}`}::regclass and contype = 'c'`;
  return rows.map((r) => r.d).join("\n");
}

describe("PD2-I50 · migration 0037 nới CHECK hub", () => {
  it("HUB-FR-146 · PD2-I50 · stage_runs skipped, review_tasks tool_failed, audit tool_call/branch, thread/room branch; giá trị cũ giữ", async () => {
    await needD2(c);
    const want: [string, string[]][] = [
      ["stage_runs", ["'skipped'", "'done'", "'running'"]],
      ["review_tasks", ["'tool_failed'", "'retry_exhausted'"]],
      ["audit_log", ["'tool_call'", "'branch'"]],
      ["process_thread_events", ["'branch'"]],
      ["room_messages", ["'branch'"]],
    ];
    const got: Record<string, string[]> = {};
    for (const [t, vals] of want) {
      const d = await checks(t);
      got[t] = vals.filter((v) => d.includes(v));
    }
    expect(got).toEqual(Object.fromEntries(want));
    // giá trị lạ ⇒ 23514: CHECK vẫn là danh sách đóng (không nới thành bỏ ràng buộc)
    expect((await checks("stage_runs")).includes("'la_lam'")).toBe(false);
  }, 30_000);
});
