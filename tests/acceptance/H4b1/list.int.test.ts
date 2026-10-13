// HUB-FR-68 · spec §3 A `GET /studio/api/secrets` · plan §2.1 (cursor), D14, D17 · test-plan H4b1 §3 A100–A106: list sắp
// (kind, lower(name), id); lọc kind / tenant_id / q (không phân biệt hoa-thường); vắng tenant_id ⇒ mọi secret; phân trang
// cursor đủ, không trùng; cursor rác ⇒ trang đầu; limit ngoài 1..100 ⇒ 400. Đỏ trước code: route chưa có ⇒ 404.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type Ctx, create, errOf, startH4b1, studio, T, val } from "./_h4b1";

let x: Ctx;
const made: number[] = [];
beforeAll(async () => {
  x = await startH4b1();
  const mk = async (
    kind: "provider_api_key" | "kh_api_key" | "source_credential",
    name: string,
    tenant_id?: string,
  ) =>
    made.push(
      (await create(x, { kind, name, value: val(name), ...(tenant_id ? { tenant_id } : {}) }))
        .status,
    );
  await mk("provider_api_key", "qcsortZeta");
  await mk("provider_api_key", "QCSORTalpha");
  await mk("provider_api_key", "qcsortMid");
  await mk("kh_api_key", "qcsortKh");
  await mk("kh_api_key", "qcsortKhAcme", T.acme);
  await mk("source_credential", "qcsortSrcBeta", T.beta);
  await mk("source_credential", "qcsortSrcAcme", T.acme);
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

const names = (r: { json: { items?: { name: string }[] } }) =>
  (r.json?.items ?? []).map((i) => i.name);

describe("A100–A106 · danh sách Studio [spec §3 A]", () => {
  it("HUB-FR-68 · A100 · dữ liệu dựng qua API ⇒ 7 × 201", () => {
    expect(made).toEqual(Array(7).fill(201));
  });
  it("HUB-FR-68 · A101 · vắng tenant_id ⇒ mọi secret (nền tảng + acme + beta), sắp (kind, lower(name)) — kind theo thứ tự chữ", async () => {
    const r = await studio(x, "padmin", "GET", "?q=qcsort");
    expect(r.status).toBe(200);
    expect(names(r)).toEqual([
      "qcsortKh",
      "qcsortKhAcme",
      "QCSORTalpha",
      "qcsortMid",
      "qcsortZeta",
      "qcsortSrcAcme",
      "qcsortSrcBeta",
    ]);
    expect(r.json.next_cursor).toBeNull();
  });
  it("HUB-FR-68 · A102 · lọc kind=provider_api_key ⇒ 3 provider; tenant_id=acme ⇒ chỉ hàng acme (kh + source)", async () => {
    const a = await studio(x, "padmin", "GET", "?q=qcsort&kind=provider_api_key");
    const b = await studio(x, "padmin", "GET", `?q=qcsort&tenant_id=${T.acme}`);
    expect([names(a), names(b)]).toEqual([
      ["QCSORTalpha", "qcsortMid", "qcsortZeta"],
      ["qcsortKhAcme", "qcsortSrcAcme"],
    ]);
  });
  it("HUB-FR-68 · A103 · q không phân biệt hoa-thường (`SORTMID`) ⇒ đúng 1", async () => {
    expect(names(await studio(x, "padmin", "GET", "?q=SORTMID"))).toEqual(["qcsortMid"]);
  });
  it("HUB-FR-68 · A104 · limit=2 + next_cursor ⇒ 4 trang (2,2,2,1), gộp lại = danh sách đầy đủ, không trùng; trang cuối next_cursor null", async () => {
    const pages: string[][] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 6; i++) {
      const q = `?q=qcsort&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const r = await studio(x, "padmin", "GET", q);
      expect(r.status).toBe(200);
      pages.push(names(r));
      cursor = r.json.next_cursor;
      if (!cursor) break;
    }
    expect(pages.map((p) => p.length)).toEqual([2, 2, 2, 1]);
    expect(pages.flat()).toEqual(names(await studio(x, "padmin", "GET", "?q=qcsort")));
  });
  it("HUB-FR-68 · A105 · cursor rác ⇒ 200 trang đầu (không 500)", async () => {
    const r = await studio(x, "padmin", "GET", "?q=qcsort&limit=2&cursor=rac%25%25");
    expect([r.status, names(r)]).toEqual([200, ["qcsortKh", "qcsortKhAcme"]]);
  });
  it("HUB-FR-68 · A106 · limit 0 / 101 / kind lạ / tenant_id không phải uuid ⇒ 400 VALIDATION_ERROR", async () => {
    const codes = [];
    for (const q of ["?limit=0", "?limit=101", "?kind=app_key", "?tenant_id=acme"])
      codes.push(errOf(await studio(x, "padmin", "GET", q)).code);
    expect(codes).toEqual(Array(4).fill("VALIDATION_ERROR"));
  });
});
