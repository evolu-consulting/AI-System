// HUB-FR-44 · HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · X2b2-R05–R07, D3, D9, C-4 · luật thuần `room-files.rules.ts` (plan §8,
// test-plan X2b2 §2 U01–U08). Nạp động: module chưa có ⇒ `{}` ⇒ mọi ca đỏ ở `expect(typeof fn)`.
import { describe, expect, it } from "bun:test";
import { type Fn, loadRoomFilesRules } from "../_modules";

async function fn(name: string): Promise<Fn> {
  const m = await loadRoomFilesRules();
  expect(typeof m[name]).toBe("function");
  return m[name];
}

const MiB = 1_048_576;
const SHA = "c".repeat(64);
type Row = {
  id: string;
  roomMessageId: string;
  seq: number;
  position: number;
  safeName: string;
  mime: string;
  size: number;
  sha256: string;
};
const row = (id: string, msg: string, seq: number, position: number, size = 1024): Row => ({
  id,
  roomMessageId: msg,
  seq,
  position,
  safeName: `${id}.pdf`,
  mime: "application/pdf",
  size,
  sha256: SHA,
});
const ids = (rs: Row[]) => rs.map((r) => r.id);

describe("X2b2-R07 · pickRoomRunFiles(rows, {triggerMessageId}) [plan §8, H2c-R14]", () => {
  it("HUB-FR-101 · X2b2-AC08 · U01 · tin gọi trước; rồi seq giảm; trong tin position tăng", async () => {
    const pick = await fn("pickRoomRunFiles");
    const rows = [
      row("f5", "m5", 5, 0),
      row("f29-p1", "m29", 29, 1),
      row("f30", "m30", 30, 0),
      row("f29-p0", "m29", 29, 0),
    ];
    expect(ids(pick(rows, { triggerMessageId: "m30" }))).toEqual(["f30", "f29-p0", "f29-p1", "f5"]);
  });

  it("HUB-FR-101 · X2b2-AC08 · U01b · tin gọi seq không lớn nhất vẫn đứng đầu (tin gọi trong thread)", async () => {
    const pick = await fn("pickRoomRunFiles");
    const rows = [row("f40", "m40", 40, 0), row("f12", "m12", 12, 0), row("f7", "m7", 7, 0)];
    expect(ids(pick(rows, { triggerMessageId: "m12" }))).toEqual(["f12", "f40", "f7"]);
  });

  it("HUB-FR-101 · X2b2-AC08 · U02 · 12 file 1 KiB ở 12 tin ⇒ đúng 10, mới nhất trước", async () => {
    const pick = await fn("pickRoomRunFiles");
    const rows = Array.from({ length: 12 }, (_, i) => row(`f${i + 1}`, `m${i + 1}`, i + 1, 0));
    const got = pick(rows, { triggerMessageId: "m12" });
    expect(ids(got)).toEqual(["f12", "f11", "f10", "f9", "f8", "f7", "f6", "f5", "f4", "f3"]);
  });

  it("HUB-FR-101 · X2b2-R07 · U03 · 6 file × 20 MiB ⇒ 5 file (tổng đúng 100 MiB nhận), file thứ 6 vượt ⇒ dừng", async () => {
    const pick = await fn("pickRoomRunFiles");
    const rows = Array.from({ length: 6 }, (_, i) =>
      row(`g${i + 1}`, `m${i + 1}`, i + 1, 0, 20 * MiB),
    );
    const got = pick(rows, { triggerMessageId: "m6" }) as Row[];
    expect(ids(got)).toEqual(["g6", "g5", "g4", "g3", "g2"]);
    expect(got.reduce((s, r) => s + r.size, 0)).toBe(100 * MiB);
  });

  it("HUB-FR-101 · X2b2-R07 · U03b · vượt 100 MiB ở giữa ⇒ dừng (không nhảy qua lấy file nhỏ cũ hơn)", async () => {
    const pick = await fn("pickRoomRunFiles");
    const rows = [
      row("a", "m9", 9, 0, 20 * MiB),
      row("b", "m8", 8, 0, 20 * MiB),
      row("c", "m7", 7, 0, 20 * MiB),
      row("d", "m6", 6, 0, 20 * MiB),
      row("e", "m5", 5, 0, 19 * MiB),
      row("f", "m4", 4, 0, 2 * MiB),
      row("g", "m3", 3, 0, 1024),
    ];
    expect(ids(pick(rows, { triggerMessageId: "m9" }))).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("HUB-FR-101 · X2b2-R07 · U04 · rows rỗng ⇒ []; tin gọi không file ⇒ bắt đầu từ seq kế", async () => {
    const pick = await fn("pickRoomRunFiles");
    expect(pick([], { triggerMessageId: "m30" })).toEqual([]);
    const rows = [row("f5", "m5", 5, 0), row("f29", "m29", 29, 0)];
    expect(ids(pick(rows, { triggerMessageId: "m30" }))).toEqual(["f29", "f5"]);
  });

  it("HUB-FR-101 · X2b2-R07 · U04b · giữ nguyên trường của hàng (không đổi hình RoomFileRow)", async () => {
    const pick = await fn("pickRoomRunFiles");
    const r = row("f1", "m1", 1, 0, 4096);
    expect(pick([r], { triggerMessageId: "m1" })).toEqual([r]);
  });
});

describe("X2b2-R07 · roomFileWindow({triggerId, main, thread?}) [plan §8, D9]", () => {
  it("HUB-FR-101 · X2b2-AC08 · U05 · [trigger, ...main, ...thread], bỏ trùng, giữ thứ tự xuất hiện đầu", async () => {
    const win = await fn("roomFileWindow");
    const main = [...Array.from({ length: 19 }, (_, i) => ({ id: `m${i + 11}` })), { id: "m30" }];
    const thread = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
    const want = ["m30", ...Array.from({ length: 19 }, (_, i) => `m${i + 11}`), "t1", "t2", "t3"];
    expect(win({ triggerId: "m30", main, thread })).toEqual(want);
  });

  it("HUB-FR-101 · X2b2-R07 · U05b · không thread ⇒ chỉ trigger + main; main rỗng ⇒ [trigger]", async () => {
    const win = await fn("roomFileWindow");
    expect(win({ triggerId: "m3", main: [{ id: "m1" }, { id: "m2" }] })).toEqual([
      "m3",
      "m1",
      "m2",
    ]);
    expect(win({ triggerId: "m3", main: [] })).toEqual(["m3"]);
    expect(
      win({ triggerId: "t9", main: [{ id: "m1" }], thread: [{ id: "t9" }, { id: "t8" }] }),
    ).toEqual(["t9", "m1", "t8"]);
  });
});

describe("X2b2-R05/R06 · canReadAttachment(a, v) [plan §8, §6.4]", () => {
  it("HUB-BR-22 · X2b2-AC02 · U06 · bảng 8 dòng: phòng ⇒ thành viên hiện tại ∧ phòng sống; hội thoại ⇒ chủ ∧ chưa xoá", async () => {
    const can = await fn("canReadAttachment");
    const A = "u-a";
    const B = "u-b";
    const room = (ownerId: string) => ({ roomId: "r1", ownerId, conversationDeleted: false });
    const conv = (deleted: boolean) => ({ roomId: null, ownerId: A, conversationDeleted: deleted });
    const v = (userId: string, roomMember: boolean, roomDeleted = false) => ({
      userId,
      roomMember,
      roomDeleted,
    });
    const table: [string, unknown, unknown, boolean][] = [
      ["phòng + thành viên (chủ file)", room(A), v(A, true), true],
      ["phòng + không thành viên", room(A), v(B, false), false],
      ["phòng + chủ file đã rời", room(A), v(A, false), false],
      ["phòng đã xoá", room(A), v(B, true, true), false],
      ["hội thoại + chủ", conv(false), v(A, false), true],
      ["hội thoại + người khác", conv(false), v(B, false), false],
      ["hội thoại đã xoá", conv(true), v(A, false), false],
      ["phòng + thành viên không phải chủ", room(A), v(B, true), true],
    ];
    for (const [label, a, viewer, want] of table)
      expect({ label, got: can(a, viewer) }).toEqual({ label, got: want });
  });
});

describe("D3 · isUnbound({messageId, roomId}) [plan §8, §5]", () => {
  it("HUB-FR-44 · X2b2-R06 · U07 · chưa gắn ⇔ messageId null ∧ roomId null", async () => {
    const un = await fn("isUnbound");
    expect(un({ messageId: null, roomId: null })).toBe(true);
    expect(un({ messageId: "m1", roomId: null })).toBe(false);
    expect(un({ messageId: null, roomId: "r1" })).toBe(false);
  });
});

describe("X2b2-R16 · attachmentRefs(rows) [plan §8, C-4]", () => {
  it("HUB-FR-44 · X2b2-R16 · U08 · [] ⇒ undefined; 2 hàng (1 purged) ⇒ available [true,false], đúng 5 khoá AttachmentRef", async () => {
    const refs = await fn("attachmentRefs");
    expect(refs([])).toBeUndefined();
    const base = { mime: "application/pdf", size: 2048 };
    const got = refs([
      { id: "a1", filename: "hoadon.pdf", ...base, purgedAt: null },
      { id: "a2", filename: "cu.pdf", ...base, purgedAt: new Date("2026-10-12T00:00:00Z") },
    ]);
    expect(got).toEqual([
      { id: "a1", filename: "hoadon.pdf", mime: "application/pdf", size: 2048, available: true },
      { id: "a2", filename: "cu.pdf", mime: "application/pdf", size: 2048, available: false },
    ]);
    for (const r of got as Record<string, unknown>[])
      expect(Object.keys(r).sort()).toEqual(["available", "filename", "id", "mime", "size"]);
  });
});
