// CR-124 · q3 · NFR-03 / Luật 4c · đường nhận lô = 4 câu SQL CỐ ĐỊNH (settings → take → insertBatch → emitReceived), không phụ thuộc số dòng.
import { describe, expect, it } from "bun:test";
import type { Tx } from "@ai/db";
import { inboxItemsOf } from "../partner-mailbox.mount";
import { partnerInboxRepo, type TakenRow } from "./partner-inbox.repo";

const row = (i: number, prevId: string | null = null): TakenRow => ({
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
  prevId,
});

async function calls(n: number, revisions = 0): Promise<number> {
  let c = 0;
  const prev = Array.from({ length: revisions }, () => crypto.randomUUID());
  // Giả DB: câu tra vòng trước trả mọi `prev` ⇒ các mục đó là bản sửa (cùng HĐ nhận cũ).
  const tx = {
    execute: async () => (
      c++,
      c === 3 && revisions > 0
        ? prev.map((p) => ({ prev: p, contract_id: crypto.randomUUID() }))
        : []
    ),
  } as unknown as Tx;
  const repo = partnerInboxRepo(tx, crypto.randomUUID());
  const taken = Array.from({ length: n }, (_, i) => row(i, prev[i] ?? null));
  await repo.settings();
  await repo.take(100);
  const items = await repo.linkRevisions(inboxItemsOf(taken));
  await repo.insertBatch(items);
  await repo.emitReceived(items);
  return c;
}

describe("partnerInboxRepo · số câu SQL mỗi lô", () => {
  it("1 dòng và 100 dòng đều đúng 4 câu (không có bản sửa ⇒ không tra vòng trước)", async () => {
    expect(await calls(1)).toBe(4);
    expect(await calls(100)).toBe(4);
  });
  it("CR-127 K8 · có bản sửa ⇒ +1 câu tra vòng trước +1 câu sửa HĐ cũ, cố định theo lô", async () => {
    expect(await calls(10, 3)).toBe(6);
    expect(await calls(100, 50)).toBe(6);
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
