// V2-F · hỗ trợ cho các spec `v2f-*.cw.ts`: backend giả `page.route` (không AI thật) ghi lại mọi yêu cầu GHI để kiểm đúng thân/đường dẫn.
// Đồng hồ cố định 2026-10-18 (giờ VN) — khớp `dataset-v2f.ts`.
import type { Page, Route } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { categoriesAsHub, facetsAsHub, listAsHub, membersAsHub } from "./dataset-list";
import { ACTIVE_ID, activeContract, lookupFor, matchFor, NEW_ID, PRODUCTS } from "./dataset-v2f";

export type Sent = { method: string; path: string; body: unknown };
export type Opts = { role?: Role; contract?: () => unknown };

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function installV2f(page: Page, o: Opts = {}): Promise<Sent[]> {
  const sent: Sent[] = [];
  const d = asHub(o.role ?? "editor");
  await page.clock.setFixedTime(new Date("2026-10-18T09:00:00+07:00"));
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  const rec = (r: Route) => {
    const q = r.request();
    if (q.method() === "GET") return;
    let body: unknown = null;
    try {
      body = q.postDataJSON();
    } catch {
      body = q.postData();
    }
    sent.push({ method: q.method(), path: new URL(q.url()).pathname, body });
  };
  const at = (p: string) => (u: URL) => u.pathname === `/pack/contracts/${p}`;
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route(at("contracts/facets"), (r) => json(r, 200, facetsAsHub()));
  await page.route(at("categories"), (r) => json(r, 200, categoriesAsHub()));
  await page.route(at("members"), (r) => json(r, 200, membersAsHub()));
  // V2-H · BA 5.8: "Nhắc trước khi hết hạn" mặc định lấy từ Cài đặt (45 để phân biệt với mặc định BA 60 khi lỗi đọc).
  await page.route(at("business-settings"), (r) => json(r, 200, { renewal_notice_days: 45 }));
  await page.route(at("contracts"), (r) => json(r, 200, listAsHub()));
  await page.route(at("products"), (r) => {
    rec(r);
    if (r.request().method() === "POST") {
      const b = r.request().postDataJSON() as { name: string; group: string; unit?: string };
      return json(r, 201, {
        id: "e1000000-0000-4000-8000-000000000099",
        name: b.name,
        unit: b.unit ?? null,
        group: b.group,
        main_supplier: null,
        created_from_contract_id: null,
        components: [],
        rules: [],
      });
    }
    return json(r, 200, { items: PRODUCTS });
  });
  await page.route(at("products/match"), (r) => {
    const b = r.request().postDataJSON() as { text: string };
    return json(r, 200, matchFor(b.text));
  });
  await page.route(at("partners/lookup"), (r) =>
    json(r, 200, lookupFor(new URL(r.request().url()).searchParams.get("name") ?? "")),
  );
  await page.route(at("contracts/manual"), (r) => {
    rec(r);
    return json(r, 201, { id: NEW_ID, status: "needs_review", version: 1 });
  });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}`, (r) =>
    json(r, 200, o.contract ? o.contract() : activeContract()),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/fields`, (r) => {
    rec(r);
    return json(r, 200, {
      id: ACTIVE_ID,
      version: 4,
      updated_at: "2026-10-18T03:00:00Z",
      fields: {},
    });
  });
  // CR-097 K1 · HD-FR-104: owner mở lại ⇒ 200 `{status: needs_review, locked: false}`.
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/reopen`, (r) => {
    rec(r);
    return json(r, 200, { id: ACTIVE_ID, status: "needs_review", version: 4, locked: false });
  });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/milestones`, (r) => {
    rec(r);
    return json(r, 201, { id: "d1000000-0000-4000-8000-0000000001ff" });
  });
  await page.route("**/pack/contracts/milestones/*", (r) => {
    rec(r);
    return r.request().method() === "DELETE"
      ? r.fulfill({ status: 204 })
      : json(r, 200, { id: "x" });
  });
  await page.route("**/pack/contracts/obligations/*/settle", (r) => {
    rec(r);
    return json(r, 200, { id: "x" });
  });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/partner`, (r) =>
    json(r, 200, { party: null, name: null }),
  );
  return sent;
}
