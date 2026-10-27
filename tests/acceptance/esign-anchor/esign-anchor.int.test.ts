// esign-anchor · int (hub-api THẬT + DB + DocuSign GIẢ cục bộ): HĐ có khối "ĐẠI DIỆN BÊN A/B" ⇒ xem trước "text" + POST /envelopes chỉ
// tài liệu HĐ, tabs anchorString theo cụm; không cụm ⇒ "page" + trang ký cuối; Cài đặt cụm (owner sửa, editor 403, tuỳ chỉnh dùng ngay).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type EsignCtx, startEsign } from "../cf-esign/_support/esign";
import { arrange, CBASE, insContract, insFile, P, pdf, T } from "../HD1/_support/hd1";

let c: EsignCtx;
beforeAll(async () => {
  c = await startEsign();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const LAN_EMAIL = "lan@acme-anchor.test";
const SIGNERS = [{ role: "company" }, { role: "partner", name: "Đối tác B", email: "b@p.test" }];
const BODY = "Điều 1. Hàng hoá, số lượng, giá. ".repeat(80);
const SIG =
  "\n\nĐẠI DIỆN BÊN A            ĐẠI DIỆN BÊN B\n(Ký, ghi rõ họ tên)   (Ký, ghi rõ họ tên)\n";
const ANCHORS = "/pack/contracts/esign/anchors";

async function setup(source: string): Promise<string> {
  await c.sql`truncate contracts.esign_envelopes`;
  await arrange(c);
  await c.sql`update admin.users set email = ${LAN_EMAIL} where id = ${P.lan.id}`;
  const id = crypto.randomUUID();
  const rowId = crypto.randomUUID();
  const up = c.fb.put(pdf(), "hd.pdf", `t_${T.acme}`);
  await insFile(c.sql, T.acme, rowId, up.file_id, "hd.pdf");
  await insContract(c.sql, {
    id,
    tenant: T.acme,
    status: "active",
    fileId: rowId,
    direction: "purchase",
    source,
  });
  expect(
    (await c.hubCall(P.lan, "PUT", "/pack/contracts/esign/settings", { enabled: true })).status,
  ).toBe(200);
  return id;
}
type Create = (typeof c.ds.creates)[number];
const lastCreate = () => c.ds.creates.at(-1) as Create;
const signTab = (cr: Create, i: number) =>
  (cr.recipients.signers[i]?.tabs?.signHereTabs?.[0] ?? {}) as Record<string, string>;

describe("esign-anchor · vị trí ô ký", () => {
  it("có khối chữ ký ⇒ xem trước 'text'; gửi ⇒ chỉ tài liệu HĐ + tabs theo cụm", async () => {
    const id = await setup(`HỢP ĐỒNG MUA BÁN\nBên A: X\nBên B: Y\n${BODY}${SIG}`);
    const pv = await c.hubCall(P.tam, "GET", `${CBASE}/${id}/esign/placement`);
    expect({ s: pv.status, b: pv.json }).toEqual({ s: 200, b: { placement: "text" } });
    const sent = await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS });
    expect(sent.status).toBe(201);
    const cr = lastCreate();
    expect(cr.documents.map((d) => d.documentId)).toEqual(["1"]);
    expect(signTab(cr, 0)).toMatchObject({
      anchorString: "ĐẠI DIỆN BÊN A",
      anchorMatchWholeWord: "true",
      anchorCaseSensitive: "false",
      anchorIgnoreIfNotPresent: "false",
    });
    expect(signTab(cr, 1).anchorString).toBe("ĐẠI DIỆN BÊN B");
  });

  it("không có cụm ⇒ 'page' + trang ký cuối (anchor ẩn)", async () => {
    const id = await setup(BODY);
    const pv = await c.hubCall(P.lan, "GET", `${CBASE}/${id}/esign/placement`);
    expect(pv.json).toEqual({ placement: "page" });
    expect(
      (await c.hubCall(P.lan, "POST", `${CBASE}/${id}/esign`, { signers: SIGNERS })).status,
    ).toBe(201);
    const cr = lastCreate();
    expect(cr.documents.map((d) => d.fileExtension)).toEqual(["pdf", "html"]);
    expect(signTab(cr, 0).anchorString).toBe("\\s1\\");
  });

  it("Cài đặt cụm: mặc định; owner sửa (editor 403); cụm tuỳ chỉnh dùng ngay; HĐ lạ 404", async () => {
    const id = await setup(`${BODY}\n\nTHAY MẶT CÔNG TY X     THAY MẶT CÔNG TY Y\n`);
    const g = await c.hubCall(P.tam, "GET", ANCHORS);
    expect(g.json).toEqual({
      a: ["ĐẠI DIỆN BÊN A", "BÊN A"],
      b: ["ĐẠI DIỆN BÊN B", "BÊN B"],
      is_default: true,
    });
    expect((await c.hubCall(P.lan, "GET", `${CBASE}/${id}/esign/placement`)).json).toEqual({
      placement: "page",
    });
    const body = { a: ["Thay mặt  Công ty X"], b: ["thay mặt công ty y"] };
    expect((await c.hubCall(P.hoa, "PUT", ANCHORS, body)).status).toBe(403);
    expect((await c.hubCall(P.lan, "PUT", ANCHORS, { a: [], b: ["x y"] })).status).toBe(400);
    const put = await c.hubCall(P.lan, "PUT", ANCHORS, body);
    expect(put.json).toEqual({
      a: ["Thay mặt Công ty X"],
      b: ["thay mặt công ty y"],
      is_default: false,
    });
    expect((await c.hubCall(P.lan, "GET", `${CBASE}/${id}/esign/placement`)).json).toEqual({
      placement: "text",
    });
    const [a] = await c.sql<{ n: number }[]>`select count(*)::int as n
      from contracts.approval_settings_audit where after ? 'esign_anchors'`;
    expect(a?.n).toBeGreaterThanOrEqual(1);
    const lost = await c.hubCall(P.lan, "GET", `${CBASE}/${crypto.randomUUID()}/esign/placement`);
    expect(lost.status).toBe(404);
  });
});
