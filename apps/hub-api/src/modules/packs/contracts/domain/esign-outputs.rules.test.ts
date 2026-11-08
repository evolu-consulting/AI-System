// CR-125 · m9 · đầu ra node Ký số từ phong bì trạng thái cuối (luật thuần) + dữ liệu trả lời của đối tác.
import { describe, expect, test } from "bun:test";
import { viDayOf } from "@ai/contracts/pack-contracts";
import { partnerReplyData } from "../partner-mailbox.mount";
import { esignOutputsOf } from "./esign-outputs.rules";

const signer = (name: string, signed_at: string | null) => ({
  name,
  email: `${name.toLowerCase()}@x.vn`,
  signed_at,
});

describe("esignOutputsOf (CR-125 m9)", () => {
  test("ký xong ⇒ envelope_id + signed_at (GIỮ mốc đầy đủ) + người ký theo thứ tự ký", () => {
    const o = esignOutputsOf({
      envelopeId: "env-1",
      status: "completed",
      completedAt: "2026-11-07T03:04:05.000Z",
      signers: [signer("Bình", "2026-11-07T03:00:00Z"), signer("An", "2026-11-06T01:00:00Z")],
    });
    expect(o).toEqual({
      envelope_id: "env-1",
      signed_at: "2026-11-07T03:04:05.000Z",
      signer: "An, Bình",
    });
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
  test("ký 00:00–07:00 giờ VN (UTC hôm trước): đầu ra giữ mốc UTC, ngày hiển thị là ngày VN", () => {
    const o = esignOutputsOf({
      envelopeId: "e",
      status: "completed",
      completedAt: "2026-11-06T18:30:00.000Z", // 01:30 ngày 07/11 giờ VN
      signers: [signer("An", "2026-11-06T18:30:00Z")],
    });
    expect(o.signed_at).toBe("2026-11-06T18:30:00.000Z");
    expect(viDayOf(o.signed_at as string)).toBe("07/11/2026"); // cắt theo UTC sẽ ra 06/11
    expect(viDayOf("2026-11-07T16:59:59Z")).toBe("07/11/2026");
    expect(viDayOf("2026-11-07T17:00:00Z")).toBe("08/11/2026"); // 00:00 VN
  });
});

describe("esignOutputsOf (CR-125 m9) · người ký, từ chối", () => {
  test("người ký đã ký theo isSigned (trạng thái completed/signed dù không có mốc) vào tên", () => {
    const o = esignOutputsOf({
      envelopeId: "e",
      status: "completed",
      completedAt: "2026-11-07T00:00:00.000Z",
      signers: [
        { name: "An", email: "a@x.vn", signed_at: null, status: "COMPLETED" },
        { name: "Bình", email: "b@x.vn", signed_at: null, status: "sent" },
      ],
    });
    expect(o.signer).toBe("An");
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
