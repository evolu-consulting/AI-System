// CR-125 · cr125-fix-docusign-return · gộp trạng thái người ký từ nhà cung cấp: cùng email nhiều người ký ghép theo thứ tự; người ký
// `completed` thiếu mốc giờ vẫn có `signed_at` (một định nghĩa "đã ký" với web/hub).
import { describe, expect, it } from "bun:test";
import { mergeSigners } from "./esign.helpers";
import type { ESignEnvelopeInfo, StoredSigner } from "./esign.ports";

const S = (
  order: number,
  email: string,
  role: "company" | "partner" = "company",
): StoredSigner => ({
  role,
  name: `S${order}`,
  email,
  order,
  client_user_id: role === "company" ? `u${order}` : null,
  status: null,
  signed_at: null,
  provider: null,
  certificate_ref: null,
});
const info = (recipients: ESignEnvelopeInfo["recipients"]) => ({
  status: "sent",
  reason: null,
  completedAt: null,
  recipients,
});

describe("mergeSigners", () => {
  it("người ký trước ký xong ⇒ chỉ người đó có signed_at, người sau giữ nguyên", () => {
    const r = mergeSigners(
      [S(1, "a@x"), S(2, "b@x", "partner")],
      info([
        { email: "A@x", status: "completed", signedAt: "2026-11-08T01:00:00Z" },
        { email: "b@x", status: "sent", signedAt: null },
      ]),
      "sent",
    );
    expect(r.map((x) => x.signed_at)).toEqual(["2026-11-08T01:00:00Z", null]);
  });
  it("cùng một email cho hai người ký ⇒ ghép lần lượt, không dồn cả hai về người đầu", () => {
    const r = mergeSigners(
      [S(1, "d@x"), S(2, "d@x", "partner")],
      info([
        { email: "d@x", status: "completed", signedAt: "2026-11-08T01:00:00Z" },
        { email: "d@x", status: "sent", signedAt: null },
      ]),
      "sent",
    );
    expect(r.map((x) => x.signed_at)).toEqual(["2026-11-08T01:00:00Z", null]);
  });
  it("completed mà nhà cung cấp thiếu mốc giờ ⇒ lấy mốc dự phòng (không để 'đã ký' mà signed_at rỗng)", () => {
    const r = mergeSigners(
      [S(1, "a@x")],
      info([{ email: "a@x", status: "completed", signedAt: null }]),
      "sent",
      "2026-11-08T02:00:00.000Z",
    );
    expect(r[0]?.signed_at).toBe("2026-11-08T02:00:00.000Z");
  });
});

describe("mergeSigners (thứ tự người nhận)", () => {
  it("nhà cung cấp trả người nhận KHÁC thứ tự ⇒ ghép theo recipientId (= vị trí + 1), kể cả trùng email", () => {
    const r = mergeSigners(
      [S(1, "d@x"), S(2, "d@x", "partner")],
      info([
        { email: "d@x", status: "sent", signedAt: null, recipientId: "2", routingOrder: 2 },
        {
          email: "d@x",
          status: "completed",
          signedAt: "2026-11-08T01:00:00Z",
          recipientId: "1",
          routingOrder: 1,
        },
      ]),
      "sent",
    );
    expect(r.map((x) => x.signed_at)).toEqual(["2026-11-08T01:00:00Z", null]);
  });
  it("không có recipientId ⇒ ghép theo routingOrder + email; không có cả hai ⇒ theo vị trí", () => {
    const r = mergeSigners(
      [S(1, "d@x"), S(2, "d@x", "partner")],
      info([
        { email: "d@x", status: "sent", signedAt: null, routingOrder: 2 },
        { email: "d@x", status: "completed", signedAt: "2026-11-08T01:00:00Z", routingOrder: 1 },
      ]),
      "sent",
    );
    expect(r.map((x) => x.signed_at)).toEqual(["2026-11-08T01:00:00Z", null]);
  });
});
