// PK-FR-08 · PK-FR-09 · N1 plan §8: `createItem` ghi item rồi 1 hàng outbox (entity `item`, op `upsert`) trong CÙNG một lần
// `uow.tenant` (một tx); lỗi ghi ⇒ không enqueue.
import { describe, expect, test } from "bun:test";
import type { PackUow } from "../../kit/application/ports";
import { createItem, ITEM_ENTITY } from "./create-item.usecase";
import type { PkdemoRepos } from "./ports";

const WHO = { tenantId: "a5e10000-0000-4000-8000-000000000001", userId: "u" };

function harness(failInsert = false) {
  const log: string[] = [];
  let txs = 0;
  const repos: PkdemoRepos = {
    items: {
      insert: async (it) => {
        if (failInsert) throw new Error("boom");
        log.push(`insert:${it.id}`);
      },
      get: async () => null,
      runOf: async () => undefined,
      attachRun: async () => false,
    },
    outbox: {
      enqueue: async (rows) => {
        log.push(`outbox:${rows.map((r) => `${r.entity}/${r.entity_id}/${r.op}`).join(",")}`);
      },
    },
  };
  const uow: PackUow<PkdemoRepos> = {
    tenant: async (_who, fn) => {
      txs++;
      return fn(repos);
    },
  };
  let n = 0;
  const create = createItem({ uow, newId: () => `id${++n}` });
  return { create, log, txs: () => txs };
}

describe("PK-FR-08 · createItem + outbox cùng tx", () => {
  test("một tx: insert trước, outbox sau, đúng entity/id/op", async () => {
    const h = harness();
    const item = await h.create(WHO, { title: "t", lines: [{ text: "a" }] });
    expect(h.txs()).toBe(1);
    expect(h.log).toEqual([`insert:${item.id}`, `outbox:${ITEM_ENTITY}/${item.id}/upsert`]);
  });

  test("ghi lỗi ⇒ ném, không enqueue", async () => {
    const h = harness(true);
    await expect(h.create(WHO, { title: "t", lines: [] })).rejects.toThrow("boom");
    expect(h.log).toEqual([]);
  });
});
