// CR-184 · Cài đặt › «Chữ ký» đọc 2 API riêng của công ty; mock tối thiểu để mở được mục này trong e2e backend giả.

import { SIGNATURE_SETTINGS_DEFAULT } from "@ai/contracts/signature";
import type { Page, Route } from "@playwright/test";

const json = (r: Route, body: unknown) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

export async function mockSignature(page: Page, canEdit = true) {
  await page.route("**/company/signature-settings", (r) =>
    json(r, {
      settings: SIGNATURE_SETTINGS_DEFAULT,
      stored: false,
      updated_by: null,
      updated_at: null,
      can_edit: canEdit,
    }),
  );
  await page.route("**/company/signature-change-requests*", (r) => json(r, { items: [] }));
}
