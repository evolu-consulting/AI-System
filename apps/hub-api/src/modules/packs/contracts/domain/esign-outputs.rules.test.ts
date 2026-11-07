// CR-125 · m9 · đầu ra node Ký số từ phong bì trạng thái cuối (luật thuần) + dữ liệu trả lời của đối tác.
import { describe, expect, test } from "bun:test";
import { partnerReplyData } from "../partner-mailbox.mount";
import { esignOutputsOf } from "./esign-outputs.rules";

const signer = (name: string, signed_at: string | null) => ({
  name,
  email: `${name.toLowerCase()}@x.vn`,
  signed_at,
});

describe("esignOutputsOf (CR-125 m9)", () => {
  test("ký xong ⇒ envelope_id + signed_at (ngày) + người ký theo thứ tự ký", () => {
    const o = esignOutputsOf({
      envelopeId: "env-1",
      status: "completed",
      completedAt: "2026-11-07T03:04:05.000Z",
      signers: [signer("Bình", "2026-11-07T03:00:00Z"), signer("An", "2026-11-06T01:00:00Z")],
    });
    expect(o).toEqual({ envelope_id: "env-1", signed_at: "2026-11-07", signer: "An, Bình" });
  });
  test("ký xong không mốc ký từng người ⇒ mọi người ký", () => {
    const o = esignOutputsOf({
      envelopeId: "e",
      status: "completed",
      completedAt: "2026-11-07T00:00:00.000Z",
      signers: [signer("An", null), { name: " ", email: "b@x.vn", signed_at: null }],
    });
    expect(o.signer).toBe("An, b@x.vn");
  });
  test("từ chối / huỷ ⇒ chỉ envelope_id", () => {
    const base = { envelopeId: "e", completedAt: null, signers: [signer("An", null)] };
    expect(esignOutputsOf({ ...base, status: "declined" })).toEqual({ envelope_id: "e" });
    expect(esignOutputsOf({ ...base, status: "voided" })).toEqual({ envelope_id: "e" });
  });
});

describe("partnerReplyData (CR-125 m9)", () => {
  test("lần gửi + lý do; lý do rỗng ⇒ không có khoá", () => {
    expect(partnerReplyData({ round: 2, reason: " Sai giá " })).toEqual({
      round: 2,
      partner_reason: "Sai giá",
    });
    expect(partnerReplyData({ round: 1, reason: null })).toEqual({ round: 1 });
    expect(partnerReplyData({ round: 1, reason: "  " })).toEqual({ round: 1 });
  });
});
