// CR-124 · q3 · NFR-03 / Luật 4c · đường nhận lô = 4 câu SQL CỐ ĐỊNH (settings → take → insertBatch → emitReceived), không phụ thuộc số dòng.
import { describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { inboxItemsOf } from "../partner-mailbox.mount";
import { partnerInboxRepo, type TakenRow } from "./partner-inbox.repo";

const row = (i: number): TakenRow => ({
  id: crypto.randomUUID(),
  round: 1,
  prevReason: null,
  payload: { title: `HĐ ${i}`, importance_hint: "normal", fields: { total_value: 600_000_000 } },
  fileRef: null,
  pdfSha256: null,
  expiresAt: new Date().toISOString(),
  senderName: "Công ty A",
  senderTaxCode: null,
  senderVerified: false,
});

async function calls(n: number): Promise<number> {
  let c = 0;
  const tx = { execute: async () => (c++, []) } as unknown as Tx;
  const repo = partnerInboxRepo(tx, crypto.randomUUID());
  const items = inboxItemsOf(Array.from({ length: n }, (_, i) => row(i)));
  await repo.settings();
  await repo.take(100);
  await repo.insertBatch(items);
  await repo.emitReceived(items);
  return c;
}

describe("partnerInboxRepo · số câu SQL mỗi lô", () => {
  it("1 dòng và 100 dòng đều đúng 4 câu", async () => {
    expect(await calls(1)).toBe(4);
    expect(await calls(100)).toBe(4);
  });
  it("CR-125 G7 · số chờ cho menu = đúng 1 câu SQL, trả 0 khi không có hàng", async () => {
    let c = 0;
    const tx = { execute: async () => (c++, []) } as unknown as Tx;
    expect(await partnerInboxRepo(tx, crypto.randomUUID()).pendingCount()).toBe(0);
    expect(c).toBe(1);
  });
  it("mức cuối = max(gợi ý, luật theo giá trị): 600 triệu gợi ý thường ⇒ quan trọng", () => {
    expect(inboxItemsOf([row(1)])[0]?.importance).toBe("important");
  });
});
