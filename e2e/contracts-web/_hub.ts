// CR-180: backend giả dùng chung của contracts-web (tách từ scenes.cw.ts để `mobile-rules.cw.ts` dùng lại; hành vi không đổi).
import type { Page } from "@playwright/test";
import { asHub } from "./dataset";
import { approvalAsHub } from "./dataset-approval";
import { contract, contractAsHub } from "./dataset-contract";
import { categoriesAsHub, facetsAsHub, membersAsHub } from "./dataset-list";
import {
  bizListAsHub,
  contractsListAsHub,
  overviewAsHub,
  partnersForOverview,
  todoAsHub,
} from "./dataset-overview";
import { ACTIVE_ID, activeContract, lookupFor, matchFor, PRODUCTS } from "./dataset-v2f";

/** Id của HĐ đọc lỗi (cảnh S05). */
export const FAILED_ID = contract.id.replace(/1$/, "2");

/** contracts-web: `/auth/refresh` + `/pack/contracts/me` giả bằng dữ liệu chung (asHub). */
export async function installHub(page: Page, signedIn: boolean) {
  const d = asHub("editor");
  const json = (
    route: Parameters<Parameters<Page["route"]>[1]>[0],
    status: number,
    body: unknown,
  ) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/auth/refresh", (r) =>
    signedIn
      ? json(r, 200, d.grant)
      : json(r, 401, { error: { code: "UNAUTHORIZED", message: "Hết phiên" } }),
  );
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  const at = (name: string) => (u: URL) => u.pathname === `/pack/contracts/${name}`;
  await page.route(at("contracts"), (r) =>
    json(r, 200, contractsListAsHub(new URL(r.request().url()).searchParams)),
  );
  await page.route(at("my-work/todo"), (r) => json(r, 200, todoAsHub()));
  await page.route(at("overview"), (r) =>
    json(r, 200, overviewAsHub(new URL(r.request().url()).searchParams.get("period") ?? "month")),
  );
  await page.route(at("business/products"), (r) => json(r, 200, bizListAsHub()));
  await page.route(at("partners"), (r) =>
    json(r, 200, partnersForOverview(new URL(r.request().url()).searchParams)),
  );
  await page.route(at("contracts/facets"), (r) => json(r, 200, facetsAsHub()));
  await page.route(at("categories"), (r) => json(r, 200, categoriesAsHub()));
  await page.route(at("members"), (r) => json(r, 200, membersAsHub()));
  // V2-F: danh mục SP + gợi ý đối tác (form nhập tay) và HĐ đã có hiệu lực (dòng thời gian).
  await page.route(at("products"), (r) => json(r, 200, { items: PRODUCTS }));
  await page.route(at("products/match"), (r) =>
    json(r, 200, matchFor((r.request().postDataJSON() as { text: string }).text)),
  );
  await page.route(at("partners/lookup"), (r) =>
    json(r, 200, lookupFor(new URL(r.request().url()).searchParams.get("name") ?? "")),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}`, (r) =>
    json(r, 200, activeContract()),
  );
  await page.route(`**/pack/contracts/contracts/${contract.id}`, (r) =>
    json(r, 200, contractAsHub()),
  );
  // HD3: HĐ cần kiểm ở bước duyệt cấp 1, người xem quyết được ⇒ "Xác nhận"; HĐ đọc lỗi chưa có run.
  await page.route(`**/pack/contracts/contracts/${contract.id}/approval`, (r) =>
    json(r, 200, approvalAsHub("level1")),
  );
  await page.route(`**/pack/contracts/contracts/${FAILED_ID}/approval`, (r) =>
    json(r, 200, approvalAsHub(null)),
  );
  await page.route(`**/pack/contracts/contracts/${FAILED_ID}`, (r) =>
    json(r, 200, { ...contractAsHub("extract_failed"), id: FAILED_ID, items: [], warnings: [] }),
  );
}
