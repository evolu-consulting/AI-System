// HUB-FR-101 · X2b2-R07, D9, D10 · `roomRunFiles`: cửa sổ → chọn (tin gọi trước, seq giảm) → `runs.attachment_ids`.
import { describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { bindRoomOutputs, roomRunFiles } from "./room-files";
import type { RoomRefRow, RoomRunFileSqlRow } from "./room-files.repo";

const dialect = new PgDialect();
const O = { tenantId: "t1", userId: "u1" };
const TRIGGER = "a2bb0000-0000-4000-8000-0000000000a1";
const OLD = "a2bb0000-0000-4000-8000-0000000000a2";
const P = { roomId: "r1", runId: "run1", triggerId: TRIGGER, windowIds: [TRIGGER, OLD] };

const row = (id: string, msg: string, seq: number, size = 10): RoomRunFileSqlRow => ({
  ...{ id, room_message_id: msg, seq: String(seq), position: 0, safe_name: `${id}.pdf` },
  ...{ mime: "application/pdf", size: String(size), sha256: "ab" },
});

/** Tx giả: câu `select` trả `rows`; ghi lại câu `update hub.runs`. */
function fakeTx(rows: RoomRunFileSqlRow[]): { tx: Tx; updates: unknown[][] } {
  const updates: unknown[][] = [];
  const tx = {
    execute: async (q: SQL) => {
      const { sql, params } = dialect.sqlToQuery(q);
      if (sql.includes("update hub.runs")) {
        updates.push(params);
        return [];
      }
      return rows;
    },
  };
  return { tx: tx as unknown as Tx, updates };
}

describe("roomRunFiles [X2b2-D9/D10]", () => {
  it("HUB-FR-101 · X2b2-R07 · cửa sổ không file ⇒ [] và không ghi runs.attachment_ids", async () => {
    const f = fakeTx([]);
    expect(await roomRunFiles(f.tx, O, P)).toEqual([]);
    expect(f.updates).toEqual([]);
  });

  it("HUB-FR-101 · X2b2-R07 · tin gọi trước rồi seq giảm; ghi đúng thứ tự id, lọc tenant + user", async () => {
    const f = fakeTx([row("f-old", OLD, 3), row("f-new", OLD, 7), row("f-trig", TRIGGER, 9)]);
    const files = await roomRunFiles(f.tx, O, P);
    expect(files.map((x) => x.id)).toEqual(["f-trig", "f-new", "f-old"]);
    expect(files[0]).toEqual({
      id: "f-trig",
      name: "f-trig.pdf",
      mime: "application/pdf",
      size: 10,
      sha256: "ab",
      fileboxFileId: null,
      fileboxVersionId: null,
    });
    expect(f.updates).toEqual([["{f-trig,f-new,f-old}", "run1", "t1", "u1"]]);
  });

  it("HUB-FR-101 · X2b2-R07 · file đầu đã > 100 MiB ⇒ [] và không ghi", async () => {
    const f = fakeTx([row("big", TRIGGER, 9, 101 * 1024 * 1024)]);
    expect(await roomRunFiles(f.tx, O, P)).toEqual([]);
    expect(f.updates).toEqual([]);
  });
});

describe("bindRoomOutputs [X2b2-R11/D11]", () => {
  const B = { runId: "run1", tenantId: "t1", roomId: "r1", roomMessageId: "m1" };
  const ref = (id: string, position: number): RoomRefRow => ({
    ...{ room_message_id: "m1", id, filename: `${id}.md`, mime: "text/markdown" },
    ...{ size: "5", purged_at: null, position },
  });
  function capture(rows: RoomRefRow[]): { tx: Tx; q: { sql: string; params: unknown[] }[] } {
    const q: { sql: string; params: unknown[] }[] = [];
    const execute = async (s: SQL) => {
      q.push(dialect.sqlToQuery(s));
      return rows;
    };
    const tx = { execute };
    return { tx: tx as unknown as Tx, q };
  }

  it("HUB-FR-101 · X2b2-R11 · không output ⇒ undefined (khoá attachments vắng)", async () => {
    expect(await bindRoomOutputs(capture([]).tx, B)).toBeUndefined();
  });

  it("HUB-FR-101 · X2b2-R11 · ref theo position; câu lọc tenant, đặt room/tin, bỏ liên kết hội thoại", async () => {
    const c = capture([ref("b", 1), ref("a", 0)]);
    const got = await bindRoomOutputs(c.tx, B);
    expect(got?.map((r) => r.id)).toEqual(["a", "b"]);
    expect(got?.[0]).toEqual({
      id: "a",
      filename: "a.md",
      mime: "text/markdown",
      size: 5,
      available: true,
    });
    const { sql, params } = c.q[0] as { sql: string; params: unknown[] };
    expect(sql).toContain("j.tenant_id = $2");
    expect(sql).toContain("a.room_id is null");
    expect(sql).toContain("conversation_id = null, flow_id = null");
    expect(params).toEqual(["run1", "t1", "r1", "m1", "t1"]);
  });
});
