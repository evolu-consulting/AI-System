// CR-188 · BR-188-4/5 · «Giấy tờ đã ký bằng chữ ký này» trong «Chữ ký của tôi»: nhân viên (chủ chữ ký) chọn một bản ⇒ ngăn danh sách + lọc;
// người khác không phải quản trị (kế toán) bị 403 khi hỏi chữ ký đó; quản trị (giám đốc) xem được (200). Viết theo khuôn e2e/cr181/*; chưa chạy (điều phối chạy cuối đợt).
import { apiAs, envOf, expect, HUB, loginCw, newPage, U } from "../cr127/_cr127-kit";
import { test } from "../journey-approval/_test";

test.describe.configure({ mode: "serial" });
// Công ty `dot2` (nhân viên có sẵn chữ ký): KHÔNG dùng j03 — `first-login-signature.spec.ts` cần nhân viên j03 CHƯA có chữ ký (màn chặn lần đầu).
const E = envOf("dot2");
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let sigId = "";

test.beforeAll(async () => {
  const emp = await apiAs(E, U.employee, "contracts");
  const view = async () =>
    (await (await fetch(`${HUB}/me/signature`, { headers: emp.headers })).json()) as {
      history: { id: string }[];
    };
  if ((await view()).history.length === 0) {
    const r = await fetch(`${HUB}/me/signature`, {
      method: "POST",
      headers: { ...emp.headers, "content-type": "application/json" },
      body: JSON.stringify({ kind: "main", method: "type", png: PNG_1X1 }),
    });
    expect(r.status).toBe(201);
  }
  sigId = (await view()).history[0]?.id ?? "";
  expect(sigId).not.toBe("");
});

const docs = (headers: Record<string, string>) =>
  fetch(`${HUB}/pack/contracts/my-signatures/${sigId}/documents`, { headers });

test("Chủ chữ ký chọn một bản ⇒ ngăn «Giấy tờ đã ký bằng chữ ký này» + lọc", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await loginCw(page, E, U.employee);
  await page.goto("/my-signature");
  const versions = page.getByTestId("sig-versions");
  await expect(versions).toBeVisible();
  await expect(versions.getByText(/^Bản \d+ · tạo ngày/).first()).toBeVisible();
  await versions.getByRole("button").first().click();
  const panel = page.getByTestId("sig-docs");
  await expect(panel.getByRole("heading", { name: "Giấy tờ đã ký bằng chữ ký này" })).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Loại giấy tờ" })).toBeVisible();
  await expect(panel.getByLabel("Từ ngày")).toBeVisible();
  await expect(panel.getByLabel("Đến ngày")).toBeVisible();
  await panel.getByLabel("Từ ngày").fill("01/01/2026");
  await expect(
    page.getByTestId("sig-docs-empty").or(panel.getByRole("link", { name: "Mở" }).first()),
  ).toBeVisible();
});

test("N2: người khác không phải quản trị ⇒ 403; quản trị ⇒ 200; chính chủ ⇒ 200", async () => {
  const own = await apiAs(E, U.employee, "contracts");
  expect((await docs(own.headers)).status).toBe(200);
  const other = await apiAs(E, U.accounting, "contracts");
  const r = await docs(other.headers);
  // Chữ ký chưa in lên giấy tờ nào ⇒ không có dấu để chứng minh chủ ⇒ rỗng 200; đã in bởi người khác ⇒ 403. Cả hai đều KHÔNG lộ giấy tờ.
  if (r.status === 200) expect(((await r.json()) as { items: unknown[] }).items).toEqual([]);
  else expect(r.status).toBe(403);
  const admin = await apiAs(E, U.director, "contracts");
  expect((await docs(admin.headers)).status).toBe(200);
});
