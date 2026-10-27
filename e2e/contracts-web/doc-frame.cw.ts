// CR-101 DOC-ui-frame · R10 · R33 · R42 · R44 · R45 · R47: chi tiết HĐ nguyên tắc (khối chứng từ con, % hạn mức, cảnh báo ngoài hiệu lực,
// diễn biến xen, mốc chỉ Nhắc gia hạn + Khác, gắn/gỡ, lỗi 422 bằng tiếng Việt) + giao dịch (nâng thành HĐ, lịch sử sửa).
// Backend giả `page.route`; không sleep.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const CH = (n: number) => `c2000000-0000-4000-8000-00000000000${n}`;
const json = (status: number, body: unknown) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const err = (status: number, code: string) => json(status, { error: { code, message: code } });

const child = (n: number, o: object = {}) => ({
  id: CH(n),
  doc_type: "contract",
  title: `Đơn đặt hàng ${n}`,
  number: `ĐH-${n}`,
  status: "active",
  value: 100_000_000,
  start_date: "2026-03-01",
  outside_frame: false,
  ...o,
});

const framework = (o: object = {}) =>
  activeContract({
    milestones: [
      {
        id: "d1000000-0000-4000-8000-0000000002a1",
        contract_id: ACTIVE_ID,
        kind: "renewal",
        title: "Nhắc gia hạn khung",
        seq: 1,
        due_date: "2026-06-01",
        owner: "ours",
        qty: null,
        amount: null,
        amount_effective: null,
        status: "open",
        confirmed: false,
        done_at: null,
        fault: null,
        postponed_to: null,
        source: "manual",
      },
    ],
    next_milestone_id: null,
    doc: {
      doc_type: "framework",
      frame_root_id: null,
      credit_limit: 1_000_000_000,
      order_terms: null,
      frame: null,
      summary: { stage: "active", value: 400_000_000, credit_pct: 40, children: 2 },
      children: [child(1), child(2, { start_date: "2027-02-01", outside_frame: true })],
    },
    ...o,
  });

test("HĐ nguyên tắc: nhãn loại, khối chứng từ con, % hạn mức, cảnh báo ngoài hiệu lực, diễn biến xen", async ({
  page,
}) => {
  await installV2f(page, { role: "editor", contract: () => framework() });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("doc-type-tag")).toHaveText("Hợp đồng nguyên tắc");
  const panel = page.getByTestId("frame-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("frame-count")).toHaveText("2");
  await expect(page.getByTestId("frame-usage")).toContainText("Đã dùng 40% hạn mức");
  await expect(page.getByTestId("frame-outside-warn")).toContainText("1 chứng từ con");
  await expect(page.getByTestId("frame-child")).toHaveCount(2);
  // diễn biến: con (03/2026) → mốc (06/2026) → con ngoài hiệu lực (02/2027)
  const nodes = page.getByTestId("frame-diary").locator("li");
  await expect(nodes).toHaveCount(3);
  await expect(nodes.nth(0)).toContainText("Đơn đặt hàng 1");
  await expect(nodes.nth(1)).toContainText("Nhắc gia hạn khung");
  await expect(nodes.nth(2)).toContainText("Ngoài hiệu lực");
});

test("HĐ nguyên tắc: hộp thêm mốc chỉ có Nhắc gia hạn + Khác", async ({ page }) => {
  await installV2f(page, { role: "editor", contract: () => framework() });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByTestId("frame-add-milestone").click();
  const kinds = page.getByRole("dialog").locator("#ms-kind option");
  await expect(kinds).toHaveCount(2);
});

test("gắn chứng từ có sẵn: chọn ⇒ POST /attach {ids}; lệch đối tác ⇒ câu tiếng Việt; gỡ ⇒ DELETE /frame", async ({
  page,
}) => {
  const sent = await installV2f(page, { role: "editor", contract: () => framework() });
  const CAND = "c3000000-0000-4000-8000-000000000001";
  await page.route(
    (u) => u.pathname === "/pack/contracts/contracts" && u.searchParams.get("nest") === "1",
    (r) =>
      r.fulfill(
        json(200, {
          items: [{ id: CAND, kind: "contract", status: "active", title: "HĐ lẻ", number: "L-1" }],
          docs: [{ id: CAND, doc_type: "contract", frame_root_id: null, frame_restricted: false }],
          parents: [],
          page: 1,
          page_size: 50,
          total: 1,
        }),
      ),
  );
  let attachStatus = 422;
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/attach`, (r) => {
    sent.push({
      method: "POST",
      path: new URL(r.request().url()).pathname,
      body: r.request().postDataJSON(),
    });
    return r.fulfill(
      attachStatus === 422
        ? err(422, "FRAME_PARTNER_MISMATCH")
        : json(200, { frame_root_id: ACTIVE_ID, attached: [CAND] }),
    );
  });
  await page.route(`**/pack/contracts/contracts/${CH(1)}/frame`, (r) => {
    sent.push({
      method: r.request().method(),
      path: new URL(r.request().url()).pathname,
      body: null,
    });
    return r.fulfill(json(200, { id: CH(1), detached: true }));
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await page.getByTestId("frame-add-menu").locator("summary").click();
  await page.getByTestId("frame-attach-open").click();
  await page.getByLabel("HĐ lẻ").check();
  await page.getByTestId("attach-submit").click();
  await expect(page.getByTestId("attach-error")).toHaveText(
    "Chứng từ phải cùng đối tác và cùng hướng (mua/bán) với HĐ nguyên tắc.",
  );
  attachStatus = 200;
  await page.getByTestId("attach-submit").click();
  await expect(page.getByTestId("attach-list")).toHaveCount(0);
  expect(sent.filter((s) => s.path.endsWith("/attach")).at(-1)?.body).toEqual({ ids: [CAND] });
  await page.getByTestId("frame-detach").first().click();
  await expect
    .poll(() => sent.some((s) => s.method === "DELETE" && s.path.endsWith("/frame")))
    .toBe(true);
});

test("chứng từ con: liên kết «thuộc HĐ nguyên tắc»; không quyền xem ⇒ nhãn riêng", async ({
  page,
}) => {
  const base = (frame: unknown) =>
    activeContract({
      doc: {
        doc_type: "contract",
        frame_root_id: CH(9),
        credit_limit: null,
        order_terms: null,
        frame,
        summary: null,
        children: [],
      },
    });
  await installV2f(page, {
    role: "editor",
    contract: () => base({ id: CH(9), title: "Khung 2026", number: "NT-1" }),
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("frame-ref")).toContainText("Khung 2026");
  await expect(page.getByTestId("doc-file-line")).toContainText("File ký:");
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await installV2f(page, { role: "editor", contract: () => base({ restricted: true }) });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("frame-ref-restricted")).toHaveText(
    "· HĐ nguyên tắc (không có quyền xem)",
  );
});

const deal = () =>
  activeContract({
    doc: {
      doc_type: "deal",
      frame_root_id: null,
      credit_limit: null,
      order_terms: null,
      frame: null,
      summary: null,
      children: [],
    },
  });

test("giao dịch: Nâng thành hợp đồng ⇒ cần file + số; multipart /promote; lỗi 422 tiếng Việt; lịch sử sửa", async ({
  page,
}) => {
  let promoted = false;
  let body = "";
  await installV2f(page, {
    role: "editor",
    contract: () => (promoted ? activeContract({ locked: true }) : deal()),
  });
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/edit-log`, (r) =>
    r.fulfill(
      json(200, {
        items: [
          {
            id: "1",
            at: "2026-10-17T02:00:00.000Z",
            actor_user_id: null,
            field: "fields.total_value",
            old_value: "100",
            new_value: "200",
          },
        ],
      }),
    ),
  );
  let fail = true;
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/promote`, (r) => {
    body = r.request().postData() ?? "";
    if (fail) return r.fulfill(err(422, "PROMOTE_NEEDS_NUMBER"));
    promoted = true;
    return r.fulfill(
      json(200, { id: ACTIVE_ID, doc_type: "contract", locked: true, version: 5, file_id: CH(5) }),
    );
  });
  await page.goto(`/contracts/${ACTIVE_ID}`);
  await expect(page.getByTestId("doc-type-tag")).toHaveText("Giao dịch");
  await expect(page.getByTestId("edit-log")).toContainText("Giá trị");
  await page.getByTestId("promote-open").click();
  const submit = page.getByTestId("promote-submit");
  await expect(submit).toBeDisabled();
  await page.getByTestId("promote-file").setInputFiles({
    name: "hd-ky.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });
  await page.getByRole("dialog").getByLabel("Số hợp đồng").fill("HĐ-2026/09");
  await submit.click();
  await expect(page.getByTestId("promote-error")).toHaveText("Cần nhập số hợp đồng.");
  fail = false;
  await submit.click();
  await expect(page.getByTestId("promote-open")).toHaveCount(0);
  expect(body).toContain("HĐ-2026/09");
  expect(body).toContain("hd-ky.pdf");
});
