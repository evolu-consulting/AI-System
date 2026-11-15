// fix-stale-resubmit · Rút về Nháp rồi Gửi lại: «Gửi lại» ghi nháp (tăng version) rồi Gửi; hub đòi lý do «không đổi gì» ⇒ lần Gửi thứ hai
// phải kèm version MỚI (không 409). Gặp CONTRACT_STALE thật thì hiện câu dễ hiểu (không chữ thô) + tự tải lại. Backend giả `page.route`, có trạng thái version.
import { expect, test } from "@playwright/test";
import { ACTIVE_ID, activeContract } from "./dataset-v2f";
import { installV2f, type Sent } from "./v2f-support";

test.skip(process.env.CW_MODE === "ref", "chỉ kiểm hành vi contracts-web");

const json = (r: import("@playwright/test").Route, status: number, body: unknown) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** Nháp đã gửi 1 vòng + có phần AI đọc (màn xác nhận ⇒ «Gửi lại» luôn ghi nháp trước). */
async function setup(page: import("@playwright/test").Page, bump: { review: number }) {
  // `version` = bản trên hub; `shown` = bản màn đang thấy (hub trả chi tiết theo `shown`; thao tác ghi xong / báo STALE thì `shown` đuổi kịp).
  const st = { version: 3, shown: 3, status: "draft" };
  const sent: Sent[] = await installV2f(page, {
    contract: () => ({
      ...activeContract({
        ai: { deal: "buy", unsure: [], summary: "x", milestones: [] },
      }),
      status: st.status,
      effect: null,
      extract_state: "ready",
      error: null,
      submit_round: 1,
      milestones: [],
      version: st.shown,
      can: {
        submit: true,
        withdraw: false,
        recreate: false,
        new_version: false,
        hold: false,
        release: false,
      },
    }),
  });
  const rec = (r: import("@playwright/test").Route) => {
    sent.push({
      method: r.request().method(),
      path: new URL(r.request().url()).pathname,
      body: r.request().postDataJSON(),
    });
  };
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/approval`, (r) =>
    json(r, 200, {
      run_id: null,
      run_status: null,
      step: null,
      task_id: null,
      can_act: false,
      feedback: null,
    }),
  );
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/review`, (r) => {
    rec(r);
    const b = r.request().postDataJSON() as { version: number };
    if (b.version !== st.version) {
      st.shown = st.version; // màn tải lại sẽ thấy bản mới
      return json(r, 409, {
        error: {
          code: "CONTRACT_STALE",
          message: "Contract was modified",
          details: { current: { version: st.version } },
        },
      });
    }
    st.version += bump.review;
    st.shown = st.version;
    return json(r, 200, { id: ACTIVE_ID, status: "draft", version: st.version, items: 0 });
  });
  let submits = 0;
  await page.route(`**/pack/contracts/contracts/${ACTIVE_ID}/submit`, (r) => {
    rec(r);
    submits += 1;
    const b = r.request().postDataJSON() as { unchanged_reason?: string };
    if (!b.unchanged_reason)
      return json(r, 422, {
        error: { code: "UNCHANGED_REASON_REQUIRED", message: "Unchanged since last round" },
      });
    st.status = "processing";
    return json(r, 200, { status: "processing", no_flow: false, round: 2 });
  });
  return { sent, st, submits: () => submits };
}

test("Gửi lại sau Rút về: lần 1 đòi lý do «không đổi», nhập lý do rồi Gửi ⇒ thành công, không «Hợp đồng vừa được cập nhật»", async ({
  page,
}) => {
  const m = await setup(page, { review: 1 });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  await page.getByTestId("act-resubmit").click();
  await expect(page.getByTestId("ask-unchanged")).toBeVisible();
  await page.getByRole("dialog").getByRole("textbox").fill("Đối tác yêu cầu gửi lại bản cũ");
  await page.getByTestId("ask-ok").click();
  await expect(page.getByTestId("ask-unchanged")).toBeHidden();
  const review = m.sent.filter((s) => s.path.endsWith("/review")).map((s) => s.body);
  expect(review.map((b) => (b as { version: number }).version)).toEqual([3, 4]); // lần 2 dùng version mới
  expect(m.sent.filter((s) => s.path.endsWith("/submit"))).toHaveLength(2);
  await expect(page.getByTestId("act-error")).toHaveCount(0);
});

test("CONTRACT_STALE thật (người khác vừa sửa) ⇒ câu dễ hiểu, không chữ thô; màn tự tải lại bản mới", async ({
  page,
}) => {
  const m = await setup(page, { review: 1 });
  await page.goto(`/contracts/c/${ACTIVE_ID}`);
  m.st.version = 9; // người khác vừa đổi sau khi màn nạp
  await page.getByTestId("act-resubmit").click();
  const err = page.getByTestId("act-error");
  await expect(err).toContainText("Hợp đồng vừa được cập nhật");
  await expect(err).not.toContainText("Contract was modified");
  // Đã tải lại bản mới ⇒ bấm lại dùng đúng version 9
  await page.getByTestId("act-resubmit").click();
  await expect(page.getByTestId("ask-unchanged")).toBeVisible();
  const last = m.sent.filter((s) => s.path.endsWith("/review")).at(-1)?.body as {
    version: number;
  };
  expect(last.version).toBe(9);
});
