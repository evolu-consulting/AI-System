// HD-AC06 · HD-AC01 · plan §5: PATCH trường — 404/409 dừng sau khoá (không ghi), y cũ ⇒ không ghi, thay đổi ⇒ save + outbox.
import { describe, expect, it } from "bun:test";
import { fillFields } from "../domain/fields.rules";
import { type LockedContract, patchFields } from "./patch-fields.usecase";

const who = { tenantId: "t", userId: "u1" };
const ID = "c0000000-0000-4000-8000-000000000001";
const T0 = "2026-10-19T00:00:00.000Z";

function setup(row: LockedContract | null) {
  const log: string[] = [];
  const saves: unknown[] = [];
  const outbox: unknown[] = [];
  const repos = {
    fields: {
      lock: async (id: string) => {
        log.push(`lock:${id}`);
        return row;
      },
      save: async (_id: string, s: unknown) => {
        log.push("save");
        saves.push(s);
        return { version: (row?.version ?? 0) + 1, updated_at: "2026-10-19T01:00:00.000Z" };
      },
    },
    outbox: {
      enqueue: async (rows: readonly unknown[]) => {
        log.push("outbox");
        outbox.push(...rows);
      },
    },
  };
  const uow = { tenant: <T>(_w: unknown, fn: (r: never) => Promise<T>) => fn(repos as never) };
  return { run: patchFields({ uow }), log, saves, outbox };
}

const base = () => {
  const f = fillFields({});
  f.notice_days = { value: 30, quote: "Điều 5", verified: false, edited: false };
  return { version: 1, updated_at: T0, fields: f };
};

describe("patchFields", () => {
  it("không có hàng ⇒ not_found, không ghi", async () => {
    const s = setup(null);
    expect(await s.run(who, ID, { version: 1, fields: { notice_days: 1 } })).toEqual({
      kind: "not_found",
    });
    expect(s.log).toEqual([`lock:${ID}`]);
  });
  it("version lệch ⇒ stale {current:{version}, updated_at}, không ghi", async () => {
    const s = setup({ ...base(), version: 3 });
    expect(await s.run(who, ID, { version: 1, fields: { notice_days: 1 } })).toEqual({
      kind: "stale",
      current: { version: 3 },
      updated_at: T0,
    });
    expect(s.log).toEqual([`lock:${ID}`]);
  });
  it("giá trị y cũ ⇒ ok, version giữ, không save/outbox", async () => {
    const s = setup(base());
    const r = await s.run(who, ID, { version: 1, fields: { notice_days: 30 } });
    expect(r.kind === "ok" && [r.out.version, r.out.updated_at]).toEqual([1, T0]);
    expect(s.log).toEqual([`lock:${ID}`]);
  });
  it("thay đổi ⇒ save (expected = version, actor = user) rồi outbox {contract, upsert}", async () => {
    const s = setup(base());
    const r = await s.run(who, ID, { version: 1, fields: { notice_days: 60 } });
    expect(s.log).toEqual([`lock:${ID}`, "save", "outbox"]);
    expect(s.saves[0]).toMatchObject({
      expected: 1,
      actor: "u1",
      changes: [{ key: "notice_days", old: 30, new: 60 }],
    });
    expect(s.outbox).toEqual([{ entity: "contract", entity_id: ID, op: "upsert" }]);
    expect(r.kind === "ok" && r.out.fields.notice_days).toEqual({
      value: 60,
      quote: "Điều 5",
      verified: true,
      edited: true,
    });
    expect(r.kind === "ok" && r.out.version).toBe(2);
  });
});
