// CR-125 · x2 · hạn ký của phong bì = lúc gửi + due_h giờ (banner "Đến lượt bạn ký — hạn …").
import { describe, expect, it } from "bun:test";
import { dueAtOf, envelopeOut } from "./esign.helpers";

describe("dueAtOf", () => {
  it("cộng due_h giờ vào lúc gửi (ISO)", () => {
    expect(dueAtOf("2026-11-07T00:00:00.000Z", 168)).toBe("2026-11-14T00:00:00.000Z");
  });
  it("không đặt hạn hoặc ngày hỏng ⇒ null", () => {
    expect(dueAtOf("2026-11-07T00:00:00.000Z", null)).toBeNull();
    expect(dueAtOf("không-phải-ngày", 24)).toBeNull();
  });
});

describe("envelopeOut · is_you", () => {
  const row = {
    id: "e",
    provider: "selfsign",
    status: "sent",
    signers: [
      {
        role: "company",
        name: "A",
        email: "a@x",
        order: 1,
        client_user_id: "u1",
        status: null,
        signed_at: null,
      },
    ],
    createdAt: "2026-11-07T00:00:00.000Z",
    dueH: 24,
  } as never;
  it("đánh dấu người ký là người xem; không truyền người xem ⇒ không có is_you", () => {
    expect(envelopeOut(row, true, "Ký thử", "u1").signers[0]?.is_you).toBe(true);
    expect(envelopeOut(row, true, "Ký thử", "u2").signers[0]?.is_you).toBe(false);
    expect(envelopeOut(row, true, "Ký thử").signers[0]).not.toHaveProperty("is_you");
    expect(envelopeOut(row, true, "Ký thử", "u1").due_at).toBe("2026-11-08T00:00:00.000Z");
  });
});
