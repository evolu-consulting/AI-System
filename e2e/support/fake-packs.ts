// CR-112 · ADM-FR-78 · backend gói giả có trạng thái dùng chung cho e2e tab "Ứng dụng & Gói": DB e2e gốc không chạy migration gói nên
// `/admin/tenants/:id/packs*` giả bằng `page.route` (hành vi API bật gói đã phủ ở int `tests/acceptance/N1/admin-packs.int.test.ts`).
// GET liệt kê (kèm role_count/member_count), PUT bật (200 PackState), DELETE tắt (204); ghi lại các lời gọi ghi theo thứ tự.
import type { Page } from "@playwright/test";

export type FakePack = {
  key: string;
  enabled: boolean;
  groups: { role: string; group_id: string }[];
  role_count: number;
  member_count: number;
};

const GROUPS = ["owner", "editor", "viewer"].map((role, i) => ({
  role,
  group_id: `00000000-0000-4000-8000-00000000000${i + 1}`,
}));

/** `sync`: mô phỏng phần server cấp/thu hồi 3 entitlement mức khi bật/tắt gói (ghi vào DB e2e thật). */
export async function fakePacks(
  page: Page,
  tenantId: string,
  init: Partial<FakePack> = {},
  sync?: (key: string, on: boolean) => Promise<void>,
) {
  const state: FakePack[] = [
    { key: "contracts", enabled: false, groups: [], role_count: 3, member_count: 3, ...init },
  ];
  const calls: string[] = [];
  const re = new RegExp(`/admin/tenants/${tenantId}/packs(?:/([a-z_]+))?$`);
  await page.route(re, async (route) => {
    const req = route.request();
    const key = re.exec(new URL(req.url()).pathname)?.[1];
    const row = state.find((p) => p.key === key);
    if (req.method() === "GET" && !key) return route.fulfill({ json: { items: state } });
    if (!row) return route.fulfill({ status: 404, json: { error: { code: "PACK_NOT_FOUND" } } });
    calls.push(`${req.method()} ${key}`);
    if (req.method() === "PUT") {
      Object.assign(row, { enabled: true, groups: GROUPS });
      await sync?.(row.key, true);
      return route.fulfill({ json: row });
    }
    row.enabled = false;
    await sync?.(row.key, false);
    return route.fulfill({ status: 204, body: "" });
  });
  return calls;
}
