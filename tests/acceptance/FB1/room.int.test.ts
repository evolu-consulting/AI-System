// HUB-FR-44 · HUB-FR-98 · HUB-FR-138 · HUB-FR-139 · HUB-FR-142 · FB1-AC-01 · AC-04 · AC-05 · AC-10 (nhánh phòng/nhóm X2b-2): cùng một driver FileBox
// cho file phòng — upload → FileBox + cột filebox_*; thành viên phòng GET /content → 302; người ngoài phòng/khác tenant → 404 TRƯỚC khi phát link;
// chủ xoá phòng → /content 404 ngay (scope core-only: không còn ca sweeper DELETE).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { captureLogs, type LogLine } from "../H2b/_h2b";
import { codeOf } from "../X2a/_x2a";
import { settle } from "../X2b/_x2b";
import {
  attCols,
  type CtxX,
  deleteRoom,
  dropUnbound,
  getContent,
  group,
  pdf,
  sendFiles,
  uploadId,
} from "../X2b2/_x2b2";
import { type FbFake, needFb, startFbFake } from "./_fb1";
import { startX2b2Fb } from "./_fb1room";

let c: CtxX;
let fake: FbFake;
let log: { lines: LogLine[]; restore: () => void };

beforeAll(async () => {
  fake = startFbFake();
  c = await startX2b2Fb(fake);
}, 60_000);
beforeEach(() => {
  fake.reset();
  log = captureLogs();
});
afterEach(async () => {
  log.restore();
  await settle(c.sql);
  await dropUnbound(c.sql);
});
afterAll(async () => {
  await c?.stop();
  await fake?.close();
});

/** GET /content không theo redirect. */
async function content(who: "lan" | "hoa" | "an", id: string) {
  const res = await fetch(`${c.hub.base}/attachments/${id}/content`, {
    headers: {
      authorization: `Bearer ${await c.tok(who)}`,
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
    },
    redirect: "manual",
    keepalive: false,
  });
  await res.arrayBuffer();
  return { status: res.status, location: res.headers.get("location") ?? "" };
}
async function roomFile(name: string) {
  const room = await group(c, "lan", ["hoa"], name);
  const id = await uploadId(c, "lan", "hoadon.pdf", pdf(4096));
  await sendFiles(c, "lan", room, "đây là hoá đơn", [id]);
  return { room, id };
}

describe("FB1 · file phòng/nhóm với driver FileBox [X2b-2]", () => {
  it("HUB-FR-138 · FB1-AC-01 · m1 · upload + gửi vào phòng: 1 POST /files; hàng có filebox_file_id khớp FileBox, storage_key tenant/id, gắn phòng", async () => {
    await needFb(c.sql);
    const { id } = await roomFile("Phòng FB m1");
    const row = await attCols(c.sql, id);
    expect(fake.callsTo("post").length).toBe(1);
    expect(row?.filebox_file_id).toBe(fake.ids()[0]);
    expect(typeof row?.filebox_version_id).toBe("string");
    expect(row?.room_id).toBeTruthy();
    expect(String(row?.storage_key)).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  });

  it("HUB-FR-139 · FB1-AC-04 · m2 · thành viên phòng (hoa) GET /content → 302 tới FILEBOX_URL + /d/…; không proxy byte (không call /content)", async () => {
    const { id } = await roomFile("Phòng FB m2");
    fake.reset();
    const r = await content("hoa", id);
    expect(r.status).toBe(302);
    expect(r.location.startsWith(`${fake.origin}/d/`)).toBe(true);
    expect(fake.callsTo("link").length).toBe(1);
    expect(fake.callsTo("content").length).toBe(0);
  });

  it("HUB-FR-139 · FB1-AC-05 · m3 · người ngoài (an, tenant khác) → 404 NOT_FOUND, FileBox không nhận call nào", async () => {
    const { id } = await roomFile("Phòng FB m3");
    fake.reset();
    const r = await getContent(c, "an", id);
    expect(codeOf(r)).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(fake.calls).toEqual([]);
  });

  it("HUB-FR-98 · FB1-AC-05 · m4 · chủ xoá phòng ⇒ thành viên /content 404 NGAY (RLS/phòng xoá chặn trước), không gọi /link", async () => {
    const { room, id } = await roomFile("Phòng FB m4");
    expect((await deleteRoom(c, "lan", room)).status).toBe(204);
    fake.reset();
    expect(codeOf(await getContent(c, "hoa", id))).toEqual({ status: 404, code: "NOT_FOUND" });
    expect(fake.calls).toEqual([]);
  });
});
