// HUB-FR-44 · HUB-BR-22 · HUB-FR-96 · HUB-FR-99 · X2b2-R05, R12, R16, R17, R19 · test-plan X2b2 §3.1 I01–I10 (rủi ro cao; S2):
// đọc file phòng chỉ cho THÀNH VIÊN HIỆN TẠI cùng tenant (kể cả người upload đã rời ⇒ 404); `GET /attachments/:id[/content]`
// ngoài phòng ⇒ 404 NOT_FOUND (không 403); RLS chặn cả khi bỏ lọc app (SQL scope user); metadata qua `room.message`, không byte.
// Người: A=lan · B=hoa · C=cuc (acme, ngoài phòng) · TA=tadmin · khác tenant=an (beta; zeta của `zed` bị khoá tenant ⇒ dùng
// beta, G6: `padmin` coi như người ngoài). Đỏ trước code: tin phòng có `attachment_ids` bị strict X2a từ chối (400).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { sha256 } from "../H2c/_h2c";
import { asUser, codeOf, mkDm, msgEv, openMeStream } from "../X2a/_x2a";
import { invoke, P, settle, waitAgentMsg } from "../X2b/_x2b";
import {
  addMember,
  type CtxX,
  call,
  dropUnbound,
  finishWith,
  getAtt,
  getContent,
  group,
  HOADON,
  type Json,
  jobOutput,
  kick,
  leave,
  pdf,
  sendFiles,
  sendRoom,
  startX2b2,
  text,
  uploadId,
  type Who,
  waitRunStatus,
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

const NF = { status: 404, code: "NOT_FOUND" };
const REF = (id: string, filename: string, size: number, mime = "application/pdf") => ({
  id,
  filename,
  mime,
  size,
  available: true,
});
/** G1 {A, B} + file `hoadon.pdf` A gửi; trả id phòng, id file, byte. */
async function g1WithFile(name: string, owner: Who = "lan") {
  const room = await group(c, owner, owner === "lan" ? ["hoa"] : ["lan"], name);
  const bytes = HOADON();
  const id = await uploadId(c, "lan", "hoadon.pdf", bytes);
  const s = await sendFiles(c, "lan", room, "đây là hoá đơn", [id]);
  return { room, id, bytes, msg: s.res.json as Json };
}
const both = async (who: Who, id: string) => ({
  meta: codeOf(await getAtt(c, who, id)),
  content: codeOf(await getContent(c, who, id)),
});

describe("X2b2-AC01 · gửi + thành viên tải [R01, R17]", () => {
  it("HUB-FR-44 · X2b2-AC01 · I01 · A gửi hoadon.pdf vào G1 ⇒ 201 attachments đúng; B tải /content đúng byte + header R17", async () => {
    const { id, bytes, msg } = await g1WithFile("Phòng hoá đơn I01");
    expect(msg.attachments).toEqual([REF(id, "hoadon.pdf", 1_048_576)]);
    const r = await getContent(c, "hoa", id);
    expect(r.status).toBe(200);
    expect(r.bytes.length).toBe(1_048_576);
    expect(sha256(r.bytes)).toBe(sha256(bytes));
    expect(r.headers.get("content-type") ?? "").toStartWith("application/pdf");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-disposition") ?? "").toStartWith("attachment");
    expect(r.headers.get("cache-control") ?? "").toContain("private");
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    const meta = await getAtt(c, "hoa", id);
    expect(meta.status).toBe(200);
    expect(meta.json).toMatchObject({
      id,
      filename: "hoadon.pdf",
      size: 1_048_576,
      available: true,
    });
  });
});

describe("X2b2-AC02 · người ngoài phòng ⇒ 404 [R05, S2]", () => {
  it("HUB-BR-22 · X2b2-AC02 · I02 · C, tenant_admin, user tenant khác, platform_admin GET meta + /content ⇒ 404 NOT_FOUND (không 403)", async () => {
    const { id } = await g1WithFile("Phòng hoá đơn I02");
    for (const who of ["cuc", "tadmin", "an", "padmin"] as Who[])
      expect({ who, ...(await both(who, id)) }).toEqual({ who, meta: NF, content: NF });
  });

  it("HUB-BR-22 · X2b2-AC02 · I03 · thêm C vào G1 ⇒ C tải file cũ 200; bớt C ⇒ 404 lại", async () => {
    const { room, id } = await g1WithFile("Phòng hoá đơn I03");
    expect((await addMember(c, "lan", room, "cuc")).status).toBe(200);
    expect((await getAtt(c, "cuc", id)).status).toBe(200);
    expect((await getContent(c, "cuc", id)).status).toBe(200);
    expect((await kick(c, "lan", room, "cuc")).status).toBe(204);
    expect(await both("cuc", id)).toEqual({ meta: NF, content: NF });
  });

  it("HUB-BR-22 · X2b2-AC11 · I04 · người upload A RỜI G1 ⇒ A 404 ×2; B vẫn 200", async () => {
    const { room, id } = await g1WithFile("Phòng hoá đơn I04", "hoa");
    expect((await leave(c, "lan", room)).status).toBe(204);
    expect(await both("lan", id)).toEqual({ meta: NF, content: NF });
    expect((await getContent(c, "hoa", id)).status).toBe(200);
  });

  it("HUB-BR-22 · X2b2-AC02 · I05 · RLS (SQL scope user, bỏ lọc app): C, TA, beta, A-đã-rời đếm 0; B đếm 1", async () => {
    const { room, id } = await g1WithFile("Phòng hoá đơn I05", "hoa");
    expect((await leave(c, "lan", room)).status).toBe(204);
    const n = async (who: Who) =>
      asUser(c.sql, P[who], async (tx) => {
        const [r] = await tx<
          { n: number }[]
        >`select count(*)::int as n from hub.attachments where id = ${id}`;
        return r?.n ?? -1;
      });
    const got: Record<string, number> = {};
    for (const who of ["cuc", "tadmin", "an", "lan", "hoa"] as Who[]) got[who] = await n(who);
    expect(got).toEqual({ cuc: 0, tadmin: 0, an: 0, lan: 0, hoa: 1 });
  });

  it("HUB-FR-97 · X2b2-R19 · I06 · B ẩn DM A↔B ⇒ B vẫn tải file của tin DM", async () => {
    const dm = (await mkDm(c.hub, await c.tok("lan"), P.hoa.id)).id as string;
    const id = await uploadId(c, "lan", "dm.pdf", pdf(2048));
    await sendFiles(c, "lan", dm, "gửi bạn tệp", [id]);
    expect((await call(c, "hoa", "POST", `/rooms/${dm}/hide`)).status).toBe(204);
    expect((await getContent(c, "hoa", id)).status).toBe(200);
  });

  it("HUB-FR-101 · X2b2-R12 · I07 · B (không quyền hoadon) tải file out/ của run A ⇒ 200; usage của B không đổi", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I07");
    const s = await invoke(c, "lan", room, "@hoadon xuất báo cáo");
    const job = await c.rt.next(s.runId);
    const out = await jobOutput(c, job, "report.md", text("# Báo cáo\n\nĐã kiểm.\n"));
    await finishWith(c, job, "Đã ghi báo cáo.", [out]);
    await waitRunStatus(c.sql, s.runId, ["finished"]);
    expect(await waitAgentMsg(c, "hoa", room, s.runId)).toBeDefined();
    const usage = async () =>
      (
        await c.sql<{ n: number }[]>`select count(*)::int as n from hub.usage_logs
          where user_id = ${P.hoa.id}`
      )[0]?.n ?? -1;
    const before = await usage();
    expect((await getContent(c, "hoa", out)).status).toBe(200);
    expect(await usage()).toBe(before);
  });
});

describe("X2b2-AC14 · realtime metadata, không byte [R16]", () => {
  it("HUB-FR-99 · X2b2-AC01 · I08 · B nghe /me/stream: room.message có attachments metadata; payload < 2 KiB, không khoá nội dung", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I08");
    const s = await openMeStream(c.hub, await c.tok("hoa"));
    try {
      const id = await uploadId(c, "lan", "hoadon.pdf", HOADON());
      await sendFiles(c, "lan", room, "hoá đơn I08", [id]);
      const ev = await s.until(msgEv("hoá đơn I08"), 5_000);
      expect(ev?.valid).toBe(true);
      expect(ev?.data?.message?.attachments).toEqual([REF(id, "hoadon.pdf", 1_048_576)]);
      expect(ev?.raw.length ?? 99_999).toBeLessThan(2048);
      expect(ev?.raw ?? "").not.toContain("content_base64");
      expect(ev?.raw ?? "").not.toContain("%PDF");
    } finally {
      s.close();
    }
  });

  it("HUB-FR-100 · X2b2-AC14 · I09 · B ngắt stream rồi nối lại Last-Event-ID ⇒ tin có file đúng 1 lần, attachments đủ; trang tin khớp", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I09");
    const s1 = await openMeStream(c.hub, await c.tok("hoa"));
    await sendRoom(c, "lan", room, { content: "mốc I09" });
    const mark = await s1.until(msgEv("mốc I09"), 5_000);
    s1.close();
    expect(mark?.id ?? "").not.toBe("");
    const id = await uploadId(c, "lan", "hoadon.pdf", HOADON());
    const sent = await sendFiles(c, "lan", room, "tệp I09", [id]);
    const s2 = await openMeStream(c.hub, await c.tok("hoa"), { lastId: mark?.id ?? "" });
    try {
      const ev = await s2.until(msgEv("tệp I09"), 5_000);
      expect(ev?.data?.message?.attachments).toEqual([REF(id, "hoadon.pdf", 1_048_576)]);
      expect(s2.events.filter(msgEv("tệp I09")).length).toBe(1);
    } finally {
      s2.close();
    }
    const page = await call(c, "hoa", "GET", `/rooms/${room}/messages`);
    const m = ((page.json?.items ?? []) as Json[]).find((x) => x.id === sent.res.json.id);
    expect(m?.attachments).toEqual([REF(id, "hoadon.pdf", 1_048_576)]);
  });

  it("HUB-FR-96 · X2b2-R16 · I10 · trang tin: tin không file VẮNG khoá attachments; tin có file theo position (thứ tự gửi)", async () => {
    const room = await group(c, "lan", ["hoa"], "Phòng hoá đơn I10");
    const plain = await sendRoom(c, "lan", room, { content: "tin không file" });
    expect(plain.res.status).toBe(201);
    const b = await uploadId(c, "lan", "b.pdf", pdf(3000));
    const a = await uploadId(c, "lan", "a.pdf", pdf(2000));
    const withFiles = await sendFiles(c, "lan", room, "hai tệp", [b, a]);
    const items = ((await call(c, "hoa", "GET", `/rooms/${room}/messages`)).json?.items ??
      []) as Json[];
    const p = items.find((x) => x.id === plain.res.json.id);
    expect(p).toBeDefined();
    expect(Object.hasOwn(p ?? {}, "attachments")).toBe(false);
    const f = items.find((x) => x.id === withFiles.res.json.id);
    expect(f?.attachments).toEqual([REF(b, "b.pdf", 3000), REF(a, "a.pdf", 2000)]);
  });
});
