// HD4-FR-06 · CR-127 K6 (spec §11 "handled / action_deadline gỡ"): `POST /pack/contracts/contracts/:id/handled` ĐÃ GỠ —
// kết quả xử lý hết hạn giờ ghi qua outcome `contract.expiring` (`effect_outcome`, test ở apps/hub-api expiry-outcome.int).
// Các ca cũ (200 terminated/handled, 403 viewer, 409 CONTRACT_NOT_CONFIRMED) bị xoá có chủ ý; còn lại kiểm route không còn.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrange, CBASE, type CtxN1, P, startHd1 } from "../HD1/_support/hd1";
import { addContract, needHd4, rowOf } from "./_support/hd4";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

describe("HD4-FR-06 · route /handled đã gỡ", () => {
  it("HD4-FR-06 · POST /handled (mọi vai) ⇒ 404; HĐ không đổi (effect, version)", async () => {
    await arrange(c);
    await needHd4(c.sql);
    const id = await addContract(c.sql, { end: "2027-12-31" });
    const before = await rowOf(c.sql, id);
    for (const who of [P.hoa, P.tam]) {
      const r = await c.hubCall(who, "POST", `${CBASE}/${id}/handled`, { outcome: "not_renewed" });
      expect(r.status).toBe(404);
    }
    const after = await rowOf(c.sql, id);
    expect([after.effect, after.effect_outcome, after.version]).toEqual([
      before.effect,
      before.effect_outcome,
      before.version,
    ]);
  });
});
