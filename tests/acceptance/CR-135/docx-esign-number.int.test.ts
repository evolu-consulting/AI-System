// CR-135 Q3 + Q4 · int đường chính: (Q4) công ty TẮT ký số tải docx làm tệp chính ⇒ 201; BẬT ký số tải docx ⇒ 422 ESIGN_NEEDS_PDF
// (không lưu gì, không tốn quota), tải PDF vẫn 201; bản cập nhật theo cùng luật. (Q3) số HĐ «HĐ/2026/001» lưu đúng nguyên văn
// qua PATCH và tìm được bằng chữ không dấu / có dấu. Hạ tầng như cf-esign (hub thật + nhà cung cấp ký giả).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type EsignCtx, startEsign } from "../cf-esign/_support/esign";
import {
  arrange,
  CBASE,
  cid,
  insContract,
  listOf,
  mkFields,
  P,
  pdf,
  ROOT,
  T,
  upload,
} from "../HD1/_support/hd1";
import { needAdr0024Accepted } from "../N1/_support/load";

let c: EsignCtx;
beforeAll(async () => {
  c = await startEsign();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const SAMPLE = join(ROOT, "reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const docx = () => ({
  bytes: new Uint8Array(readFileSync(SAMPLE)),
  name: "HD-bao-bi-Minh-Phat.docx",
  type: DOCX_MIME,
});
const rowCount = async () =>
  (await c.sql`select count(*)::int as n from contracts.contracts`)[0]?.n as number;
const setEsign = async (on: boolean) => {
  const r = await c.hubCall(P.lan, "PUT", "/pack/contracts/esign/settings", { enabled: on });
  expect(r.status).toBe(200);
};

describe("CR-135 Q4 · docx làm tệp chính khi công ty không ký số", () => {
  it("tắt ký số ⇒ docx 201; bật ký số ⇒ docx 422 ESIGN_NEEDS_PDF (không tạo HĐ) còn PDF 201", async () => {
    needAdr0024Accepted();
    await arrange(c);
    await setEsign(false);
    const ok = await upload(c, P.hoa, docx());
    expect(ok.status).toBe(201);
    expect(await rowCount()).toBe(1);

    await setEsign(true);
    const bad = await upload(c, P.hoa, docx());
    expect({ status: bad.status, code: bad.json?.error?.code }).toEqual({
      status: 422,
      code: "ESIGN_NEEDS_PDF",
    });
    expect(await rowCount()).toBe(1); // không tạo thêm hàng

    const pdfOk = await upload(c, P.hoa, { bytes: pdf(), name: "hd.pdf", type: "application/pdf" });
    expect(pdfOk.status).toBe(201);
    expect(await rowCount()).toBe(2);
  });
});

describe("CR-135 Q3 · số hợp đồng giữ nguyên văn", () => {
  it("PATCH number «HĐ/2026/001» lưu đúng nguyên văn (không chuẩn hoá) và tìm được theo số", async () => {
    await arrange(c);
    await insContract(c.sql, {
      id: cid(1),
      tenant: T.acme,
      title: "Thuê kho",
      status: "needs_review",
      fields: mkFields({ number: "OLD-1" }, { quote: "Điều 1" }),
    });
    const r = await c.hubCall(P.hoa, "PATCH", `${CBASE}/${cid(1)}/fields`, {
      version: 1,
      fields: { number: "  HĐ/2026/001 " },
    });
    expect(r.status).toBe(200);
    const [row] =
      await c.sql`select fields->'number'->>'value' as n from contracts.contracts where id = ${cid(1)}`;
    expect(row?.n).toBe("HĐ/2026/001");
    for (const q of ["HĐ/2026/001", "hd/2026/001", "2026/001"]) {
      const l = await listOf(c, P.hoa, { q });
      expect({ q, ids: (l.json?.items ?? []).map((i: { id: string }) => i.id) }).toEqual({
        q,
        ids: [cid(1)],
      });
    }
  });
});
