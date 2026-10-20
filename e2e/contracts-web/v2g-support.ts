// V2-G · hỗ trợ cho `v2g-review.cw.ts`: dựng trên `installV2f` (backend giả `page.route`, không AI thật) + màn xác nhận, `/review`, gắn SP dòng đã lưu.
import type { Page, Route } from "@playwright/test";
import { ACTIVE_ID, activeContract, PRODUCTS } from "./dataset-v2f";
import {
  AI_SUMMARY,
  matchV2g,
  NEW_PRODUCT_ID,
  P_USB,
  REVIEW_ID,
  reviewContract,
} from "./dataset-v2g";
import { installV2f, type Sent } from "./v2f-support";

const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export type V2gState = {
  /** Sau khi Lưu ở tenant tắt duyệt, chi tiết trả `active`. */
  reviewStatus: "needs_review" | "active";
  /** Lưu trả về trạng thái này (tenant tắt duyệt ⇒ `active`). */
  saveStatus: "needs_review" | "active";
  /** PUT gắn SP trả 409 `ITEM_LOCKED`. */
  locked: boolean;
};

export async function installV2g(page: Page, init: Partial<V2gState> = {}) {
  const st: V2gState = {
    reviewStatus: "needs_review",
    saveStatus: "needs_review",
    locked: false,
    ...init,
  };
  const sent: Sent[] = await installV2f(page, {
    contract: () =>
      activeContract({ ai: { deal: "buy", unsure: [], summary: AI_SUMMARY, milestones: [] } }),
  });
  const rec = (r: Route) => {
    const q = r.request();
    let body: unknown = null;
    try {
      body = q.postDataJSON();
    } catch {
      body = q.postData();
    }
    sent.push({ method: q.method(), path: new URL(q.url()).pathname, body });
  };
  await page.route(
    (u) => u.pathname.startsWith("/pack/contracts/products"),
    (r) => {
      const q = r.request();
      const u = new URL(q.url());
      if (u.pathname === "/pack/contracts/products/match")
        return json(r, 200, matchV2g((q.postDataJSON() as { text: string }).text));
      if (u.pathname !== "/pack/contracts/products") return r.fallback();
      if (q.method() === "POST") {
        rec(r);
        const b = q.postDataJSON() as { name: string; group: string; unit?: string };
        return json(r, 201, {
          id: NEW_PRODUCT_ID,
          name: b.name,
          unit: b.unit ?? null,
          group: b.group,
          main_supplier: null,
          created_from_contract_id: null,
          components: [],
          rules: [],
        });
      }
      return json(r, 200, { items: [...PRODUCTS, P_USB] });
    },
  );
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}`, (r) =>
    json(
      r,
      200,
      reviewContract({ status: st.reviewStatus, version: st.reviewStatus === "active" ? 4 : 3 }),
    ),
  );
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}/review`, (r) => {
    rec(r);
    if (st.saveStatus === "active") st.reviewStatus = "active";
    return json(r, 200, {
      id: REVIEW_ID,
      status: st.saveStatus,
      version: 4,
      items: 2,
      milestones: 2,
    });
  });
  await page.route(`**/pack/contracts/contracts/${REVIEW_ID}/approval`, (r) =>
    json(r, 200, {
      run_id: null,
      run_status: null,
      step: null,
      task_id: null,
      can_act: false,
      feedback: null,
    }),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/items/*/product`, (r) => {
    rec(r);
    if (st.locked) return json(r, 409, { error: { code: "ITEM_LOCKED", message: "locked" } });
    const b = r.request().postDataJSON() as { product_id: string | null };
    return json(r, 200, { id: "x", product_id: b.product_id, component_ids: null });
  });
  return { sent, st };
}
