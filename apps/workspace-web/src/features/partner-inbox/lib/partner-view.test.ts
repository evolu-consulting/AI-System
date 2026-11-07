// CR-124 · q4 · thẻ 3 dòng hai phía + điều kiện hợp lệ ghi nhận thủ công (thuần).
import { describe, expect, it } from "bun:test";
import { type InboxItem, inboxCard, recordIssue, roundCard } from "./partner-view";

const item = (o: Partial<InboxItem> = {}): InboxItem => ({
  contract_id: "c1",
  title: "HĐ",
  sender_name: "Công ty A",
  sender_verified: true,
  round: 1,
  prev_reason: null,
  importance: "critical",
  expires_at: "2026-11-14T00:00:00Z",
  status: "pending",
  reason: null,
  ...o,
});

describe("thẻ hộp thư bên nhận", () => {
  it("chờ xác nhận: 3 dòng (trạng thái · lý do · bước kế)", () => {
    const c = inboxCard(item());
    expect(c.tone).toBe("wait");
    expect(c.lines.map((l) => l.key)).toEqual([
      "contracts.partner.in.pending",
      "contracts.partner.in.reason",
      "contracts.partner.in.nextOpen",
    ]);
  });
  it("bản sửa lần 2 hiện lý do lần trước", () => {
    const c = inboxCard(item({ round: 2, prev_reason: "sai đơn giá" }));
    expect(c.lines[1]).toMatchObject({
      key: "contracts.partner.in.reasonRound",
      vars: { prev: "sai đơn giá", round: 2 },
    });
  });
  it("đã trả lại ⇒ tông đỏ, không còn bước phải làm", () => {
    const c = inboxCard(item({ status: "returned", reason: "thiếu phụ lục" }));
    expect(c.tone).toBe("bad");
    expect(c.lines[2]?.key).toBe("contracts.partner.in.nextNone");
  });
});

describe("thẻ vòng gửi bên gửi", () => {
  const r = {
    mailbox_id: "m",
    round: 1,
    channel: "platform",
    to_name: "Công ty B",
    status: "open",
    reason: null,
    created_at: "2026-11-07T00:00:00Z",
  };
  it("đang chờ ⇒ bước kế là ghi nhận kết quả", () => {
    expect(roundCard(r).lines[2]?.key).toBe("contracts.partner.out.nextRecord");
    expect(roundCard({ ...r, channel: "manual" }).lines[0]?.key).toBe(
      "contracts.partner.out.waitManual",
    );
  });
  it("trả lại ⇒ lý do + sửa rồi gửi lại", () => {
    const c = roundCard({ ...r, status: "returned", reason: "sai đơn giá mục 3" });
    expect(c.lines.map((l) => l.key)).toEqual([
      "contracts.partner.out.returned",
      "contracts.partner.out.reason",
      "contracts.partner.out.nextFix",
    ]);
  });
});

describe("lần gửi đang giữ chờ kết nối", () => {
  const h = {
    mailbox_id: "m",
    round: 1,
    channel: "platform",
    to_name: "Công ty B",
    status: "open",
    reason: null,
    created_at: "2026-11-07T00:00:00Z",
    mb_status: "held",
    expires_at: "2026-11-14T00:00:00Z",
  };
  it("chờ công ty nhận đồng ý kết nối — không nói «bị chặn»", () => {
    const c = roundCard(h, new Date("2026-11-08T00:00:00Z"));
    expect(c.tone).toBe("wait");
    expect(c.lines.map((l) => l.key)).toEqual([
      "contracts.partner.out.held",
      "contracts.partner.out.heldWhy",
      "contracts.partner.out.heldNext",
    ]);
  });
  it("hết hạn khi vẫn chưa được nhận ⇒ «Đối tác không nhận — hết hạn»", () => {
    const c = roundCard(h, new Date("2026-11-15T00:00:00Z"));
    expect(c.tone).toBe("bad");
    expect(c.lines[0]?.key).toBe("contracts.partner.out.heldExpired");
    expect(JSON.stringify(c)).not.toMatch(/block|chặn/i);
  });
});

describe("ghi nhận thủ công hợp lệ", () => {
  const ok = {
    outcome: "returned",
    reason: "x",
    byName: "An",
    evidence: ["email.png"],
    channel: "manual",
  };
  it("thiếu lý do / tên / bằng chứng ⇒ báo đúng ô", () => {
    expect(recordIssue({ ...ok, reason: " " })).toBe("reason");
    expect(recordIssue({ ...ok, byName: "" })).toBe("byName");
    expect(recordIssue({ ...ok, evidence: [] })).toBe("evidence");
    expect(
      recordIssue({ ...ok, outcome: "confirmed", reason: "", channel: "platform", evidence: [] }),
    ).toBeNull();
  });
});
