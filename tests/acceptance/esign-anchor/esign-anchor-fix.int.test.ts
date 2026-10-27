// esign-anchor-fix · int (hub-api THẬT + DB): cụm có ký tự điều khiển (\u0000 ⇒ trước đây jsonb 500) ⇒ 400, không ghi; xem trước vị
// trí cho HĐ PDF không `source_text` trả kết quả hợp lệ (text/page/unknown) qua converter riêng.
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

const ANCHORS = "/pack/contracts/esign/anchors";

describe("esign-anchor-fix", () => {
  it("PUT /esign/anchors có \\u0000 ⇒ 400 và không ghi", async () => {
    await arrange(c);
    const r = await c.hubCall(P.lan, "PUT", ANCHORS, { a: ["BÊN\u0000A"], b: ["BÊN B"] });
    expect(r.status).toBe(400);
    const g = await c.hubCall(P.lan, "GET", ANCHORS);
    expect(g.json.is_default).toBe(true);
  });

  it("xem trước HĐ PDF không source_text ⇒ 200 với vị trí hợp lệ", async () => {
    await arrange(c);
    const id = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const up = c.fb.put(pdf(), "hd.pdf", `t_${T.acme}`);
    await insFile(c.sql, T.acme, rowId, up.file_id, "hd.pdf");
    await insContract(c.sql, { id, tenant: T.acme, status: "active", fileId: rowId });
    const a = await c.hubCall(P.tam, "GET", `${CBASE}/${id}/esign/placement`);
    const b = await c.hubCall(P.tam, "GET", `${CBASE}/${id}/esign/placement`);
    expect(a.status).toBe(200);
    expect(["text", "page", "unknown"]).toContain(a.json.placement);
    expect(b.json.placement).toBe("page"); // fixture không có lớp chữ ⇒ kết quả cuối, cache
  });
});
