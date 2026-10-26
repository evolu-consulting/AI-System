// contract-flow S4 · Luật 4b: thẻ duyệt trên engine (dòng thời gian + Đạt / Trả lại / Từ chối), chỉ-trưởng-phòng không có nút,
// chỉnh luồng lưu được (phòng lấy từ `/groups`, không cần `/admin/org`). Backend giả `page.route`; chờ phần tử, không sleep.
// VIẾT, CHƯA CHẠY (e2e chạy một lần cuối đợt).
import type { ContractApproval } from "@ai/contracts";
import { expect, type Page, test } from "@playwright/test";
import { asHub, type Role } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

type Route = Parameters<Parameters<Page["route"]>[1]>[0];
const json = (r: Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const GROUPS = [
  { id: G1, name: "Kinh doanh" },
  { id: G2, name: "Kế toán" },
];

type Step = NonNullable<ContractApproval["steps"]>[number];
const step = (idx: number, name: string, status: Step["status"], o: Partial<Step> = {}): Step => ({
  idx,
  key: `s${idx}`,
  name,
  kind: "review",
  status,
  group_id: idx === 0 ? G1 : G2,
  head_only: false,
  escalated_group_id: null,
  due_at: null,
  escalated: false,
  decided_by: null,
  decided_at: null,
  feedback: null,
  ...o,
});
const card = (steps: Step[], o: Partial<ContractApproval> = {}): ContractApproval => ({
  mode: "engine",
  run_id: G1,
  run_status: "running",
  step: "level1",
  task_id: TASK,
  can_act: true,
  feedback: null,
  finalizes_on_approve: false,
  steps,
  ...o,
});
/** Hai bước: soạn đã đạt, "Kế toán" (bước 1) đang mở. */
const AT_STEP1 = (o: Partial<ContractApproval> = {}, s1: Partial<Step> = {}) =>
  card([step(0, "Soạn & kiểm tra", "passed"), step(1, "Kế toán", "open", s1)], o);

async function install(page: Page, state: ContractApproval, role: Role = "editor") {
  const posts: Record<string, unknown>[] = [];
  const d = asHub(role);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("ai.locale", "vi");
      localStorage.setItem("assistant:open", "0");
    } catch {
      /* storage bị chặn */
    }
  });
  await page.route("**/auth/refresh", (r) => json(r, 200, d.grant));
  await page.route("**/pack/contracts/me", (r) => json(r, 200, d.packMe));
  await page.route("**/pack/contracts/groups", (r) => json(r, 200, GROUPS));
  await page.route("**/pack/contracts/contracts/**", (r) => {
    const req = r.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/approval") && req.method() === "POST") {
      posts.push(req.postDataJSON());
      return json(r, 200, { ...state, step: "done", can_act: false, task_id: null });
    }
    if (path.endsWith("/approval")) return json(r, 200, state);
    return json(r, 200, contractAsHub());
  });
  return posts;
}

test("dòng thời gian: tên bước, tên phòng, trạng thái, hạn quá hạn", async ({ page }) => {
  await install(page, AT_STEP1({}, { due_at: "2020-01-01T00:00:00.000Z" }));
  await page.goto(`/contracts/${contract.id}`);
  const tl = page.locator("[data-approval=timeline]");
  await expect(tl.getByTestId("approval-step-0")).toContainText("Soạn & kiểm tra");
  await expect(tl.getByTestId("approval-step-0")).toContainText("Đã đạt");
  await expect(tl.getByTestId("approval-step-1")).toContainText("Kế toán");
  await expect(tl.getByTestId("approval-step-1")).toContainText("Đang chờ duyệt");
  await expect(tl.getByTestId("approval-step-1")).toContainText("quá hạn");
});

test("luồng 2 bước: bước 1 bấm Đạt ⇒ POST approve (không kèm products khi chưa xác nhận HĐ)", async ({
  page,
}) => {
  const posts = await install(page, AT_STEP1());
  await page.goto(`/contracts/${contract.id}`);
  await page.locator("[data-approval=pass]").click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: "approve" });
});

test("Trả lại: cần góp ý, gửi action return", async ({ page }) => {
  const posts = await install(page, AT_STEP1());
  await page.goto(`/contracts/${contract.id}`);
  await page.locator("[data-approval=return]").click();
  const form = page.locator("[data-approval=reason]");
  await form.getByRole("button", { name: "Trả lại" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Vui lòng nhập lý do" })).toBeVisible();
  expect(posts).toHaveLength(0);
  await form.getByRole("textbox").fill("Thiếu điều khoản thanh toán");
  await form.getByRole("button", { name: "Trả lại" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: "return", feedback: "Thiếu điều khoản thanh toán" });
});

test("Từ chối: bắt buộc lý do, gửi action reject", async ({ page }) => {
  const posts = await install(page, AT_STEP1());
  await page.goto(`/contracts/${contract.id}`);
  await page.locator("[data-approval=reject]").click();
  const form = page.locator("[data-approval=reason]");
  await form.getByRole("button", { name: "Từ chối" }).click();
  expect(posts).toHaveLength(0);
  await form.getByRole("textbox").fill("Giá cao hơn hạn mức");
  await form.getByRole("button", { name: "Từ chối" }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toEqual({ action: "reject", feedback: "Giá cao hơn hạn mức" });
});

test("bước chỉ trưởng phòng, người xem không phải trưởng phòng: không có nút, có lý do", async ({
  page,
}) => {
  await install(
    page,
    AT_STEP1({ can_act: false, block_reason: "not_reviewer" }, { head_only: true }),
  );
  await page.goto(`/contracts/${contract.id}`);
  await expect(page.locator("[data-approval=timeline]")).toContainText("chỉ trưởng phòng");
  await expect(page.locator("[data-approval=note]")).toContainText("chỉ trưởng phòng duyệt");
  await expect(page.locator("[data-approval=pass]")).toHaveCount(0);
  await expect(page.locator("[data-approval=return]")).toHaveCount(0);
  await expect(page.locator("[data-approval=reject]")).toHaveCount(0);
});

test("lượt bị trả về máy cũ do ENGINE_RUN_FAILED: nói rõ lý do", async ({ page }) => {
  await install(page, {
    mode: "machine",
    run_id: G1,
    run_status: "running",
    step: "level1",
    task_id: TASK,
    can_act: true,
    feedback: "ENGINE_RUN_FAILED",
  });
  await page.goto(`/contracts/${contract.id}`);
  await expect(page.locator("[data-approval=note]")).toContainText("gặp lỗi");
});

test("chỉnh luồng: phòng lấy từ /groups (không /admin/org), sửa hạn rồi Lưu ⇒ PUT", async ({
  page,
}) => {
  await install(page, AT_STEP1(), "owner");
  const puts: { version: number; steps: unknown[] }[] = [];
  const rv = (key: string, name: string, dept: string) => ({
    kind: "review",
    key,
    name,
    department_group_id: dept,
    head_only: false,
    due_h: 72,
    remind_every_h: null,
    escalate_group_id: null,
    exclude_starter: false,
    when: null,
  });
  const FLOW = {
    version: 1,
    is_default: true,
    updated_at: null,
    steps: [rv("s0", "Soạn & kiểm tra", G1), rv("s1", "Kế toán", G2)],
  };
  await page.route("**/pack/contracts/approval-flow", (r) => {
    if (r.request().method() !== "PUT") return json(r, 200, FLOW);
    const body = r.request().postDataJSON();
    puts.push(body);
    return json(r, 200, { version: 2, is_default: false, steps: body.steps, updated_at: null });
  });
  await page.goto(`/contracts/${contract.id}`);
  // Lối vào ngay trên thẻ duyệt cho chủ sở hữu.
  await page.locator("[data-approval=edit-flow]").click();
  const dlg = page.getByRole("dialog", { name: "Cài đặt" });
  const s1 = dlg.getByTestId("flow-step-1");
  await expect(s1.getByLabel("Phòng ban")).toHaveValue(G2);
  await expect(s1.getByRole("option", { name: "Kế toán" })).toHaveCount(1);
  await s1.getByLabel("Hạn xử lý (giờ)").fill("48");
  await dlg.getByRole("button", { name: "Lưu quy trình" }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect(puts[0]?.version).toBe(1);
});
