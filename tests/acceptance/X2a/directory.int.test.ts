// HUB-FR-102 · AC-H24 · X2a-AC10 · danh bạ `GET /directory` (test-plan X2a §5.2 Y01–Y08; plan §2.2, D16; plan-db §4.5).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api, type Ctx, call, codeOf, e400, P, Q, startX2a } from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
beforeAll(async () => {
  c = await startX2a();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

type U = { id: string; display_name: string; username: string; active: boolean };
const dir = (who: Parameters<typeof c.tok>[0], q = "") =>
  c.tok(who).then((t) => api(c.hub, t, "GET", `/directory${q}`));
/** Danh sách item; đòi 200 (đỏ ở expect, không TypeError, khi route chưa có). */
const items = (r: { status: number; json: { items?: U[] } }): U[] => {
  expect(r.status).toBe(200);
  return r.json?.items ?? [];
};
const idsOf = (r: { status: number; json: { items?: U[] } }) => items(r).map((u) => u.id);

describe("Y01–Y08 · danh bạ [X2a-R22 · X2a-AC10]", () => {
  it("HUB-FR-102 · Y01 · lan thấy user acme dùng được trừ mình; không khoa, nghi, an, zed, padmin [X2a-R02 · R22 · AC-H24]", async () => {
    const all: string[] = [];
    for (const q of [
      "?q=lan&limit=50",
      "?q=hoa&limit=50",
      "?q=tam&limit=50",
      "?q=khoa",
      "?q=nghi",
      "?q=an&limit=50",
      "?q=zed",
      "?q=padmin",
      "?q=cuc",
      "?q=tadmin",
    ]) {
      const r = await dir("lan", q);
      expect({ q, s: r.status }).toEqual({ q, s: 200 });
      all.push(...idsOf(r));
    }
    expect(all).not.toContain(P.lan.id);
    for (const ok of [P.hoa.id, P.tam.id, P.cuc.id, P.tadmin.id]) expect(all).toContain(ok);
    for (const no of [P.khoa.id, P.nghi.id, P.an.id, P.zed.id, P.padmin.id])
      expect(all).not.toContain(no);
  });

  it("HUB-FR-102 · Y02 · mỗi item đúng {id, display_name, username, active}; thân trả lời không chứa email/role [X2a-R22 · X2a-AC10]", async () => {
    const r = await dir("lan", "?q=hoa");
    expect(r.status).toBe(200);
    expect(r.json.items.length).toBeGreaterThan(0);
    for (const u of r.json.items as U[])
      expect(Object.keys(u).sort()).toEqual(["active", "display_name", "id", "username"]);
    expect(r.json.items.find((u: U) => u.id === P.hoa.id)).toEqual({
      id: P.hoa.id,
      display_name: "hoa",
      username: "hoa",
      active: true,
    });
    expect(r.text).not.toContain("@example.test");
    expect(r.text).not.toContain("tenant_admin");
    expect(r.text).not.toContain("tenant_id");
  });

  it("HUB-FR-102 · Y03 · q không phân biệt hoa thường theo tên hoặc username [X2a-AC10]", async () => {
    const byName = await dir("lan", "?q=%C3%BAC%20L"); // "úC L" ⇒ display_name "Cúc Lê" (khác hoa thường ở phần ASCII)
    expect(idsOf(byName)).toContain(P.cuc.id);
    const byUser = await dir("lan", "?q=CUC");
    expect(idsOf(byUser)).toContain(P.cuc.id);
    const q07 = await dir("lan", "?q=qc%20ng%C6%B0%E1%BB%9Di%2007");
    expect(idsOf(q07)).toEqual([Q[6]?.id as string]);
  });

  it('HUB-FR-102 · Y04 · q="%" / "_" không khớp tất cả (thoát LIKE) [X2a-AC10]', async () => {
    expect(idsOf(await dir("lan", "?q=%25"))).toEqual([]);
    expect(idsOf(await dir("lan", "?q=_"))).toEqual([]);
  });

  it("HUB-FR-102 · Y05 · limit mặc định 20, 50 ok, 51 ⇒ 400; q > 100 ký tự ⇒ 400 [plan D16]", async () => {
    expect(items(await dir("lan")).length).toBe(20);
    expect(items(await dir("lan", "?limit=50")).length).toBe(50);
    expect(codeOf(await dir("lan", "?limit=51"))).toEqual(e400);
    expect(codeOf(await dir("lan", `?q=${"a".repeat(101)}`))).toEqual(e400);
  });

  it("HUB-FR-102 · Y06 · sắp lower(display_name), id [plan D16]", async () => {
    const r = await dir("lan", "?q=qc&limit=50");
    const names = items(r).map((u) => u.display_name);
    expect(names.length).toBe(50);
    expect(names).toEqual([...names].sort((x, y) => (x.toLowerCase() < y.toLowerCase() ? -1 : 1)));
    expect(names[0]).toBe("QC Người 01");
  });

  it("HUB-FR-102 · Y07 · an chỉ thấy beta (không ai acme); padmin không thấy acme [X2a-R01 · R22]", async () => {
    const an = await dir("an", "?limit=50");
    expect(an.status).toBe(200);
    for (const u of idsOf(an))
      expect([P.lan.id, P.hoa.id, P.cuc.id, ...Q.map((q) => q.id)]).not.toContain(u);
    const pa = await dir("padmin", "?limit=50");
    expect(pa.status).toBe(200);
    expect(idsOf(pa).filter((u) => [P.lan.id, P.hoa.id, P.cuc.id].includes(u))).toEqual([]);
  });

  it("HUB-FR-102 · Y08 · không token ⇒ 401 [X2a-R22]", async () => {
    const r = await call(c.hub, "GET", "/directory");
    expect(r.status).toBe(401);
  });
});
