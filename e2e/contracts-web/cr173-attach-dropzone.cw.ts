// CR-173 · «Tài liệu kèm»: vùng đính tệp dùng chung — viền nét đứt, «Kéo thả tệp vào đây hoặc Chọn tệp», đổi trạng thái khi rê tệp, thả tệp gửi lên (backend giả `page.route`).
import { expect, type Page, test } from "@playwright/test";
import { asHub } from "./dataset";
import { contract, contractAsHub } from "./dataset-contract";
import { mockContractFiles } from "./flow-mock";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

async function open(page: Page): Promise<void> {
  const d = asHub("editor");
  await page.addInitScript(() => {
    localStorage.setItem("ai.locale", "vi");
    localStorage.setItem("assistant:open", "0");
  });
  const j = (r: Parameters<Parameters<Page["route"]>[1]>[0], b: unknown) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(b) });
  await page.route("**/auth/refresh", (r) => j(r, d.grant));
  await page.route("**/pack/contracts/me", (r) => j(r, d.packMe));
  await page.route("**/pack/contracts/contracts/**", (r) => j(r, contractAsHub("draft")));
  await mockContractFiles(page, { can_add: true, locked: false });
  await page.goto(`/contracts/c/${contract.id}`);
}

test("CR173 · vùng đính tệp: viền nét đứt, câu kéo thả + nút Chọn tệp, rê tệp ⇒ đổi trạng thái", async ({
  page,
}) => {
  await open(page);
  const zone = page.getByTestId("cfiles").getByTestId("attach-dropzone");
  await expect(zone).toContainText("Kéo thả tệp vào đây hoặc");
  await expect(zone.getByRole("button", { name: "Chọn tệp" })).toBeVisible();
  await expect(zone).toHaveCSS("border-top-style", "dashed");
  await expect(zone).not.toHaveAttribute("data-active", "true");
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await zone.dispatchEvent("dragenter", { dataTransfer: dt });
  await expect(zone).toHaveAttribute("data-active", "true");
  await expect(zone).toContainText("Thả tệp để đính kèm");
  await zone.dispatchEvent("dragleave", { dataTransfer: dt });
  await expect(zone).not.toHaveAttribute("data-active", "true");
});

test("CR173 · thả tệp vào vùng ⇒ gửi tệp lên Tài liệu kèm", async ({ page }) => {
  await open(page);
  const sent = page.waitForRequest(
    (r) => r.method() === "POST" && /\/pack\/contracts\/contracts\/[^/]+\/files$/.test(r.url()),
  );
  await page.route("**/pack/contracts/contracts/*/files", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({ status: 201, contentType: "application/json", body: "{}" })
      : r.fallback(),
  );
  const dt = await page.evaluateHandle(() => {
    const d = new DataTransfer();
    d.items.add(new File(["x"], "bao-gia.pdf", { type: "application/pdf" }));
    return d;
  });
  await page.getByTestId("cfiles").getByTestId("attach-dropzone").dispatchEvent("drop", {
    dataTransfer: dt,
  });
  expect((await sent).postData()).toContain("bao-gia.pdf");
});
