// esign-sweep · luật thuần chọn hàng đến hạn (đồng hồ giả, không sleep) + chuông của lô.
import { describe, expect, it } from "bun:test";
import { type EsignOpenRow, esignDueOf } from "../domain/esign-sweep.rules";
import { type EsignSweptRow, esignSweepBells } from "./esign-sweep";

const T0 = new Date("2026-10-01T00:00:00Z");
const h = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const sent = (o: Partial<EsignOpenRow> = {}): EsignOpenRow => ({
  status: "sent",
  at: T0,
  remindedAt: null,
  escalatedAt: null,
  due_h: 72,
  remind_every_h: 24,
  ...o,
});

describe("esign-sweep · esignDueOf", () => {
  it("sending: kẹt khi quá staleMin phút, chưa thì không", () => {
    const r = sent({ status: "sending" });
    expect(esignDueOf(r, new Date(T0.getTime() + 9 * 60_000), 10).stale).toBe(false);
    expect(esignDueOf(r, new Date(T0.getTime() + 11 * 60_000), 10)).toEqual({
      stale: true,
      remind: false,
      overdue: false,
    });
  });
  it("nhắc mỗi remind_every_h kể từ lần gửi / lần nhắc trước; null ⇒ không nhắc", () => {
    expect(esignDueOf(sent(), h(23), 10).remind).toBe(false);
    expect(esignDueOf(sent(), h(24), 10).remind).toBe(true);
    expect(esignDueOf(sent({ remindedAt: h(24) }), h(47), 10).remind).toBe(false);
    expect(esignDueOf(sent({ remindedAt: h(24) }), h(48), 10).remind).toBe(true);
    expect(esignDueOf(sent({ remind_every_h: null }), h(100), 10).remind).toBe(false);
    // mốc nhắc của lần gửi trước (cũ hơn `at`) ⇒ tính từ `at`
    expect(esignDueOf(sent({ at: h(50), remindedAt: h(24) }), h(73), 10).remind).toBe(false);
  });
  it("quá hạn due_h ⇒ chuyển cấp một lần mỗi lần gửi", () => {
    expect(esignDueOf(sent(), h(71), 10).overdue).toBe(false);
    expect(esignDueOf(sent(), h(72), 10).overdue).toBe(true);
    expect(esignDueOf(sent({ escalatedAt: h(72) }), h(200), 10).overdue).toBe(false);
    // Gửi lại ⇒ `at` mới, mốc chuyển cấp cũ hết hiệu lực
    expect(esignDueOf(sent({ at: h(80), escalatedAt: h(72) }), h(152), 10).overdue).toBe(true);
  });
});

const row = (o: Partial<EsignSweptRow>): EsignSweptRow => ({
  approvalId: "a",
  contractId: "k",
  owner: "own",
  signer: "sig",
  label: "HĐ-1",
  escalateGroupId: null,
  stale: false,
  remind: false,
  overdue: false,
  ...o,
});

describe("esign-sweep · esignSweepBells", () => {
  it("kẹt ⇒ người phụ trách; nhắc ⇒ người ký; quá hạn ⇒ người phụ trách + Group (không trùng)", () => {
    const b = esignSweepBells(
      [
        row({ contractId: "k1", stale: true }),
        row({ contractId: "k2", remind: true }),
        row({ contractId: "k3", overdue: true, escalateGroupId: "g" }),
      ],
      new Map([["g", ["own", "boss"]]]),
    );
    expect(b.map((x) => [x.user_id, x.link, x.title])).toEqual([
      ["own", "/contracts/k1", "Ký số HĐ HĐ-1 cần quyết"],
      ["sig", "/contracts/k2", "Nhắc ký số HĐ HĐ-1"],
      ["own", "/contracts/k3", "Ký số HĐ HĐ-1 quá hạn"],
      ["boss", "/contracts/k3", "Ký số HĐ HĐ-1 quá hạn"],
    ]);
  });
  it("thiếu người nhận ⇒ bỏ qua", () => {
    expect(
      esignSweepBells([row({ owner: null, signer: null, stale: true, remind: true })], new Map()),
    ).toEqual([]);
  });
});
