// CR-178 · unit luật thuần «Ảnh & tệp»: con trỏ + dựng DTO.
import { describe, expect, it } from "bun:test";
import { attachmentOf, decodeAttachCursor, encodeAttachCursor } from "./messages.find";

const ID = "0a0b0c0d-1111-4222-8333-444455556666";

describe("CR-178 M4 · con trỏ Ảnh & tệp", () => {
  it("mã hoá rồi giải mã trả đúng (seq, id)", () => {
    expect(decodeAttachCursor(encodeAttachCursor({ seq: 7, id: ID }))).toEqual({ seq: 7, id: ID });
  });
  it("hỏng ⇒ null: không phải base64 JSON, sai dạng, seq < 1, id không phải uuid", () => {
    const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    for (const s of [
      "",
      "%%%",
      enc("x"),
      enc([1]),
      enc([0, ID]),
      enc([1.5, ID]),
      enc([1, "abc"]),
      enc(["1", ID]),
    ])
      expect([s, decodeAttachCursor(s)]).toEqual([s, null]);
  });
});

describe("CR-178 M4 · attachmentOf", () => {
  const raw = {
    id: ID,
    name: "a.png",
    mime: "image/png",
    size: 12,
    seq: 3,
    sender_id: ID,
    at: "2026-11-16T01:02:03.456789Z",
  };
  it("ảnh ⇒ kind image; pdf ⇒ file; thời điểm ISO; tên người gửi do bên gọi truyền", () => {
    const img = attachmentOf(raw, "Vy");
    expect([img.kind, img.sender_name, img.at, img.seq]).toEqual([
      "image",
      "Vy",
      "2026-11-16T01:02:03.456Z",
      3,
    ]);
    expect(attachmentOf({ ...raw, mime: "application/pdf" }, "").kind).toBe("file");
  });
});
