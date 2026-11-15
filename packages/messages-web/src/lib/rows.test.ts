// CR-136 · ghép tin tạm/thật theo client_id (không nháy), trạng thái lỗi giữ tin.
import { describe, expect, it } from "bun:test";
import type { Message } from "@ai/contracts/pack-contracts";
import { mergeRows, type PendingMsg, stateOf } from "./rows";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const msg = (seq: number, at = "2026-11-12T09:00:00", clientN = seq): Message => ({
  id: id(100 + seq),
  seq,
  conversation_id: id(1),
  sender_id: id(2),
  client_id: id(200 + clientN),
  body: `t${seq}`,
  files: [],
  at,
  deleted: false,
});
const pend = (n: number, failed: string | null = null): PendingMsg => ({
  clientId: id(200 + n),
  body: `p${n}`,
  fileNames: [],
  failed,
});

describe("mergeRows", () => {
  it("tin đang gửi nằm cuối, CÙNG nhóm ngày hôm nay với tin thật (không đổi cha khi được thay)", () => {
    const g = mergeRows([msg(1, "2026-11-11T09:00:00"), msg(2)], [pend(9)], "2026-11-12");
    expect(g.map((x) => [x.day, x.rows.length])).toEqual([
      ["2026-11-11", 1],
      ["2026-11-12", 2],
    ]);
    expect(g[1]?.rows[1]?.kind).toBe("pending");
  });
  it("khoá tin tạm = client_id; khi server xác nhận khoá tin thật y hệt ⇒ phần tử được giữ", () => {
    const before = mergeRows([msg(1)], [pend(9)], "2026-11-12");
    const after = mergeRows([msg(1), msg(2, "2026-11-12T10:00:00", 9)], [], "2026-11-12");
    const k = (g: ReturnType<typeof mergeRows>) => g.flatMap((x) => x.rows.map((r) => r.key));
    expect(k(before)[1]).toBe(k(after)[1]);
    expect(after[0]?.rows[1]?.kind).toBe("sent");
  });
  it("tin tạm đã có bản thật (msg.new tới trước kết quả POST) ⇒ không hiện hai lần", () => {
    const g = mergeRows([msg(1, "2026-11-12T09:00:00", 9)], [pend(9)], "2026-11-12");
    expect(g.flatMap((x) => x.rows).length).toBe(1);
    expect(g[0]?.rows[0]?.kind).toBe("sent");
  });
  it("không có tin thật hôm nay ⇒ tạo nhóm hôm nay cho tin đang gửi", () => {
    const g = mergeRows([msg(1, "2026-11-10T09:00:00")], [pend(9)], "2026-11-12");
    expect(g.map((x) => x.day)).toEqual(["2026-11-10", "2026-11-12"]);
  });
});

describe("stateOf", () => {
  it("sent / sending / failed (lỗi giữ nguyên tin để gửi lại)", () => {
    const [g] = mergeRows(
      [msg(1)],
      [pend(8), pend(9, "contracts.messages.err.load")],
      "2026-11-12",
    );
    expect(g?.rows.map(stateOf)).toEqual(["sent", "sending", "failed"]);
  });
});
