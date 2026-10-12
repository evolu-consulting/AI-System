// HUB-FR-44 · HUB-FR-98 · X2b2-R13, R14, D3, D6 · test-plan X2b2 §3.6 I47–I50 (S1, S5): xoá phòng ⇒ `/content` 404 ngay, sau một
// lượt sweeper (`sweepOnce`, đồng hồ tiêm) hàng còn + `purged_at` = now + nội dung mất; file ĐÃ GẮN phòng sống không bị sweeper
// "chưa gắn" xoá dù > 24 h; file chưa gắn > 24 h vẫn bị xoá; hàng đã purged không bị claim lại. Bẫy §1: KHÔNG khẳng định số đếm
// `SweepResult` (sweeper toàn cục) — chỉ trạng thái hàng/file của chính ca.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { codeOf } from "../X2a/_x2a";
import { settle } from "../X2b/_x2b";
import {
  age,
  attCols,
  type CtxX,
  deleteRoom,
  dropUnbound,
  getContent,
  group,
  onDisk,
  pdf,
  sendFiles,
  startX2b2,
  sweep,
  uploadId,
} from "./_x2b2";

let c: CtxX;
beforeAll(async () => {
  c = await startX2b2();
}, 60_000);
afterEach(async () => {
  await settle(c.sql);
  await dropUnbound(c.sql);
});
afterAll(() => c?.stop());

const HOUR = 3_600_000;
async function g1File(name: string) {
  const room = await group(c, "lan", ["hoa"], name);
  const id = await uploadId(c, "lan", "hoadon.pdf", pdf(4096));
  await sendFiles(c, "lan", room, "đây là hoá đơn", [id]);
  return { room, id };
}
const purgedMs = async (id: string): Promise<number | null> => {
  const p = (await attCols(c.sql, id))?.purged_at;
  return p ? new Date(String(p)).getTime() : null;
};

describe("X2b2-AC11 · xoá phòng ⇒ xoá nội dung [R13, D6]", () => {
  it("HUB-FR-98 · X2b2-AC11 · I47 · chủ xoá G1 ⇒ B /content 404 NGAY; sau sweepOnce(now): hàng còn, purged_at = now, file mất trên đĩa", async () => {
    const { room, id } = await g1File("Phòng hoá đơn I47");
    expect(await onDisk(c, id)).toBe(true);
    expect((await deleteRoom(c, "lan", room)).status).toBe(204);
    expect(codeOf(await getContent(c, "hoa", id))).toEqual({ status: 404, code: "NOT_FOUND" });
    const now = new Date(Date.now() + 60_000);
    await sweep(c, now);
    expect(await attCols(c.sql, id)).toBeDefined();
    expect(await purgedMs(id)).toBe(now.getTime());
    expect(await onDisk(c, id)).toBe(false);
  });

  it("HUB-FR-44 · X2b2-AC11 · I50 · sweepOnce lần 2 (sau 1 giờ) ⇒ hàng đã purged KHÔNG bị claim lại (purged_at giữ nguyên)", async () => {
    const { room, id } = await g1File("Phòng hoá đơn I50");
    expect((await deleteRoom(c, "lan", room)).status).toBe(204);
    const t1 = new Date(Date.now() + 60_000);
    await sweep(c, t1);
    expect(await purgedMs(id)).toBe(t1.getTime());
    await sweep(c, new Date(t1.getTime() + HOUR));
    expect(await purgedMs(id)).toBe(t1.getTime());
    const [n] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.attachments where id = ${id}`;
    expect(n?.n).toBe(1);
  });
});

describe("X2b2-AC11 · sweeper 'chưa gắn' không đụng file phòng [R14, D3, S1]", () => {
  it("HUB-FR-44 · X2b2-AC11 · I48 · file gắn G1, created_at −25 h, G1 sống ⇒ sweepOnce KHÔNG xoá; B tải 200", async () => {
    const { id } = await g1File("Phòng hoá đơn I48");
    await age(c.sql, id, 25 * HOUR);
    await sweep(c, new Date());
    expect(await attCols(c.sql, id)).toBeDefined();
    expect(await purgedMs(id)).toBeNull();
    expect(await onDisk(c, id)).toBe(true);
    expect((await getContent(c, "hoa", id)).status).toBe(200);
  });

  it("HUB-FR-44 · X2b2-AC11 · I49 · file chưa gắn −24 h −1 s ⇒ bị xoá sau sweepOnce (hồi quy H2c-R27)", async () => {
    const id = await uploadId(c, "lan", "chuagan.pdf", pdf(2048));
    await age(c.sql, id, 24 * HOUR + 1000);
    await sweep(c, new Date());
    expect(await attCols(c.sql, id)).toBeUndefined();
  });
});
