// X1-AC12 (e2e) · ADM-FR-37 · ADM-FR-36 · HUB-FR-78/79 · tab Agent của Group + Quyền hiệu lực phần agent
// (plan-frontend §2.3, §2.4). Hub = stub 4030 (`/agent-grants*`).
import { expect, type Page, test } from "@playwright/test";
import { rowOf } from "../support/helpers";
import {
  ID3,
  loginAdmin,
  loginAs,
  SETUP,
  stubMode,
  stubRequests,
  TENANT_ID,
  toast,
  USER_ID,
} from "./_support";

test.beforeEach(SETUP);

const KT = ID3.group.acmeKeToan;
const open = async (page: Page, qs = "") => {
  await page.goto(`/groups/${KT}?tab=agents${qs}`);
  await expect(page.getByRole("tab", { name: "Agent", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(chatbot(page)).toBeVisible();
};
const trello = (page: Page) => page.getByRole("switch", { name: "Cấp Trello cho Kế toán" });
const chatbot = (page: Page) =>
  page.getByRole("switch", { name: "Cấp Chatbot (Dify) cho Kế toán" });

test("X1-AC12 · tab 'Agent': Chatbot (Dify) đã cấp, Trello chưa cấp và có badge 'Chưa chạy được'; GET có subject, có Bearer, không tenant_id", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await open(page);
  await expect(chatbot(page)).toBeChecked();
  await expect(trello(page)).not.toBeChecked();
  await expect(page.getByText("Chưa chạy được")).toBeVisible();
  const calls = await stubRequests("/agent-grants");
  expect(calls[0]?.search).toContain(`subject_id=${KT}`);
  expect(calls[0]?.search).toContain("subject_type=group");
  expect(calls[0]?.search).not.toContain("tenant_id");
  expect(calls[0]?.auth).toBe(true);
});

test("X1-AC12 · bật 'Cấp Trello cho Kế toán' ⇒ POST 1 lần + toast 'Đã cấp Trello cho Kế toán'; tắt ⇒ DELETE + toast 'Đã thu hồi Trello khỏi Kế toán'", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await open(page);
  await trello(page).click();
  await expect(toast(page, "Đã cấp Trello cho Kế toán")).toBeVisible();
  expect((await stubRequests("/agent-grants")).filter((r) => r.method === "POST")).toHaveLength(1);
  await trello(page).click();
  await expect(toast(page, "Đã thu hồi Trello khỏi Kế toán")).toBeVisible();
  expect((await stubRequests("/agent-grants")).filter((r) => r.method === "DELETE")).toHaveLength(
    1,
  );
});

for (const [mode, text] of [
  ["NOT_ENTITLED", "Công ty chưa được mở agent này."],
  ["AGENT_NOT_GRANTABLE", "Agent đang tắt hoặc chưa chạy được, không cấp được."],
  ["500", "Không kết nối được Hub."],
] as const) {
  test(`X1-AC12 · lỗi ${mode} khi cấp: switch hoàn lại tắt + câu '${text}'`, async ({ page }) => {
    await stubMode({ grantWrite: mode });
    await loginAs(page, "acme", "binh");
    await open(page);
    await trello(page).click();
    await expect(page.getByText(text).first()).toBeVisible();
    await expect(trello(page)).not.toBeChecked();
  });
}

test("X1-AC12 · platform_admin truyền tenant_id của ?tenant= lên /agent-grants", async ({
  page,
}) => {
  await loginAdmin(page);
  await open(page, `&tenant=${TENANT_ID.acme}`);
  await expect(chatbot(page)).toBeVisible();
  const calls = await stubRequests("/agent-grants");
  expect(calls.some((c) => c.search.includes(`tenant_id=${TENANT_ID.acme}`))).toBe(true);
});

test("X1-AC12 · Kiểm tra quyền (lan): heading 'Agent' có 'Qua group Kế toán' và 'Chưa được cấp'", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto("/access?tab=check&user=lan&tenant=acme");
  await expect(page.getByRole("heading", { level: 3, name: "Agent" })).toBeVisible();
  await expect(page.getByText("Qua group Kế toán", { exact: true })).toBeVisible();
  await expect(page.getByText("Chưa được cấp", { exact: true })).toBeVisible();
  const calls = await stubRequests("/agent-grants/effective/");
  expect(calls[0]?.path).toBe(`/agent-grants/effective/${USER_ID.lan}`);
});

test("X1-AC12 · drawer user (lan) › tab 'Quyền hiệu lực': heading 'Agent' có 'Qua group Kế toán' và 'Chưa được cấp'", async ({
  page,
}) => {
  await loginAs(page, "acme", "binh");
  await page.goto("/users");
  await rowOf(page, "Users", "lan").getByRole("button", { name: "Thao tác khác" }).click();
  await page.getByRole("menuitem", { name: "Sửa", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: /lan · / });
  await drawer.getByRole("tab", { name: "Quyền hiệu lực" }).click();
  await expect(drawer.getByRole("heading", { level: 3, name: "Agent" })).toBeVisible();
  await expect(drawer.getByText("Qua group Kế toán", { exact: true })).toBeVisible();
  await expect(drawer.getByText("Chưa được cấp", { exact: true })).toBeVisible();
});
