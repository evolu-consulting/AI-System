// PK-FR-06 · PK-AC07 · D-07 · plan §6: FileBox theo tenant cho file gói — `org = t_<tenant_id>`, truy cập qua id HÀNG của gói
// (`pkdemo.files`), tenant khác ⇒ 404 không lộ tồn tại, không gọi FileBox, log không chứa URL `/d/` hay file_id.
// FileBox giả FB1 (`startFbFake`); seam hub: `deps.packs.filebox` (xem `_support/n1.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { utf8 } from "../FB1/_fbfake";
import { captureLogs } from "../X2a/_x2a";
import { type CtxN1, ID, needPackKit, P, PK, seedFile, startN1, T } from "./_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startN1();
});
afterAll(async () => {
  await c?.stop();
});
/** acme: lan=owner · tam=viewer · cuc không Group; beta: an=owner. Mỗi tenant 1 file gói có thật trong FileBox giả. */
async function arrange(): Promise<{ fidA: string; fidB: string }> {
  await needPackKit(c.sql);
  c.fb.reset();
  await c.sql`truncate pkdemo.files`;
  await c.enable(T.acme);
  await c.enable(T.beta);
  await c.addToRole(T.acme, "owner", [P.lan]);
  await c.addToRole(T.acme, "viewer", [P.tam]);
  await c.addToRole(T.beta, "owner", [P.an]);
  const a = c.fb.put(utf8("noi dung A"), "hd.pdf", `t_${T.acme}`);
  const b = c.fb.put(utf8("noi dung B"), "hd.pdf", `t_${T.beta}`);
  await seedFile(c.sql, T.acme, ID.fileA, a.file_id);
  await seedFile(c.sql, T.beta, ID.fileB, b.file_id);
  return { fidA: a.file_id, fidB: b.file_id };
}
/** GET không theo redirect (đích là FileBox `/d/…`). */
async function getContent(p: (typeof P)[keyof typeof P], rowId: string) {
  return fetch(`${c.hub.base}/pack/${PK}/files/${rowId}/content`, {
    headers: { authorization: `Bearer ${await c.tok(p)}` },
    redirect: "manual",
  });
}

describe("PK-AC07 · file gói theo tenant", () => {
  it("PK-AC07 · tenant A xin link bằng id hàng của mình ⇒ 302 tới /d/…; FileBox nhận đúng 1 lời gọi link cho file_id của A", async () => {
    const { fidA } = await arrange();
    const r = await getContent(P.lan, ID.fileA);
    expect(r.status).toBe(302);
    expect(r.headers.get("location") ?? "").toMatch(/\/d\/[^/]+$/);
    const links = c.fb.callsTo("link");
    expect(links.map((x) => ({ fileId: x.fileId, auth: x.auth, status: x.status }))).toEqual([
      { fileId: fidA, auth: "ok", status: 200 },
    ]);
  });
  it("PK-AC07 · hàng gói lưu org=t_<tenant_id> (CHECK ở DB) — đối chứng seed hợp lệ", async () => {
    await arrange();
    const rows = await c.sql<
      { tenant_id: string; org: string }[]
    >`select tenant_id, org from pkdemo.files order by org`;
    expect(rows.every((r) => r.org === `t_${r.tenant_id}`)).toBe(true);
    expect(rows).toHaveLength(2);
  });
  it("PK-AC07 · user tenant B xin link bằng id hàng của A ⇒ 404 NOT_FOUND, FileBox KHÔNG bị gọi", async () => {
    await arrange();
    const r = await c.hubCall(P.an, "GET", `/pack/${PK}/files/${ID.fileA}/content`);
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 404,
      code: "NOT_FOUND",
    });
    expect(c.fb.calls.filter((x) => x.route !== "health")).toEqual([]);
  });
  it("PK-AC07 · 404 của hàng lạ và của tenant khác GIỐNG HỆT nhau (không lộ tồn tại)", async () => {
    await arrange();
    const other = await c.hubCall(P.an, "GET", `/pack/${PK}/files/${ID.fileA}/content`);
    const ghost = await c.hubCall(P.an, "GET", `/pack/${PK}/files/${ID.ghost}/content`);
    expect({ s: other.status, b: other.json }).toEqual({ s: ghost.status, b: ghost.json });
  });
  it("PK-AC07 · log không chứa URL đầy đủ /d/… và không chứa file_id của FileBox (cả đường 302 lẫn 404)", async () => {
    const { fidA } = await arrange();
    const cap = captureLogs();
    try {
      const ok = await getContent(P.lan, ID.fileA);
      const loc = ok.headers.get("location") ?? "";
      await c.hubCall(P.an, "GET", `/pack/${PK}/files/${ID.fileA}/content`);
      const all = cap.lines.join("\n");
      expect({
        d: /\/d\//.test(all),
        fileId: all.includes(fidA),
        loc: loc !== "" && all.includes(loc),
      }).toEqual({ d: false, fileId: false, loc: false });
    } finally {
      cap.restore();
    }
  });
  it("PK-FR-06 · phản hồi 302 không phơi file_id; Location chỉ cùng origin FileBox", async () => {
    const { fidA } = await arrange();
    const r = await getContent(P.lan, ID.fileA);
    const loc = r.headers.get("location") ?? "";
    expect(JSON.stringify([...r.headers.entries()]).includes(fidA)).toBe(false);
    expect(await r.text()).not.toContain(fidA);
    expect(new URL(loc, c.fb.origin).origin).toBe(new URL(c.fb.origin).origin);
  });
  it("PK-FR-06 · quyền đọc: viewer (read) ⇒ 302; user không Group (cuc) ⇒ 403 PACK_FORBIDDEN, FileBox không bị gọi", async () => {
    await arrange();
    const v = await getContent(P.tam, ID.fileA);
    const callsAfterViewer = c.fb.callsTo("link").length;
    const n = await c.hubCall(P.cuc, "GET", `/pack/${PK}/files/${ID.fileA}/content`);
    expect([v.status, n.status, n.json?.error?.code]).toEqual([302, 403, "PACK_FORBIDDEN"]);
    expect(c.fb.callsTo("link").length).toBe(callsAfterViewer);
  });
  it("PK-FR-06 · file đã xoá mềm (deleted_at) ⇒ 404, FileBox không bị gọi", async () => {
    await arrange();
    await c.sql`update pkdemo.files set deleted_at = now() where id = ${ID.fileA}`;
    const r = await c.hubCall(P.lan, "GET", `/pack/${PK}/files/${ID.fileA}/content`);
    expect(r.status).toBe(404);
    expect(c.fb.callsTo("link")).toEqual([]);
  });
  it("PK-FR-06 · FileBox lỗi 5xx ⇒ fail-closed (5xx của Hub), không trả Location rỗng/giả", async () => {
    await arrange();
    c.fb.failAlways("link", 503);
    const r = await getContent(P.lan, ID.fileA);
    c.fb.failAlways("link", null);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.headers.get("location")).toBeNull();
  });
});
