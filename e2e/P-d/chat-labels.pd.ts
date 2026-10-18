// CHAT-AC-59 · AC-H39 · AC-H41 · AC-H42 · HUB-FR-143 · HUB-FR-144 · HUB-FR-145 · P-d1 · e2e chat-web (test-plan-e2e PD-E06…E08; nhãn
// nguyên văn plan-frontend §7 + i18n). Trạng thái dựng bằng SQL (`_pd-support`), KHÔNG chờ giờ thật.
// Ca "ngày sai ⇒ alert 'Chọn một ngày hợp lệ.'" của PD-E08(d) không dựng được bằng trình duyệt: <input type=date> của Chromium từ chối
// giá trị không phải ngày lịch (value rỗng) nên nhánh `dateInvalid` chỉ tới được bằng giá trị gõ tay — phủ ở unit inputs-rules.
import { expect, type Page, test } from "@playwright/test";
import { roomComposer } from "../chat/_x2a-support";
import { flowLog, openThread } from "../P-a/_pa-support";
import {
  mkRoom,
  seedEscalated,
  seedPd,
  seedPd2Run,
  seedPdDecision,
  seedTimerRun,
  settle,
  users,
} from "./_pd-support";

test.beforeAll(() => seedPd());
test.afterEach(() => settle());

const strip = (p: Page) => p.getByRole("list", { name: "Tiến độ quy trình" });
const decision = (p: Page) => p.getByRole("region", { name: "Cần người quyết" });

test("CHAT-AC-59 · AC-H39 · PD-E06 · run chờ thử lại (retry_count 2) ⇒ dải tiến độ 'Đang thử lại (2/3)'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD06");
  const r = await seedTimerRun(room.id, "retry");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    await expect(
      strip(u.A).getByRole("listitem").filter({ hasText: "Đang thử lại (2/3)" }),
    ).toBeVisible();
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-59 · AC-H41 · PD-E07 · run chờ tới 17/11/2026 (HCM) ⇒ dải 'Chờ tới 17/11/2026', huy hiệu 'Đang chờ hẹn', dòng trạng thái 'Chờ tới 17/11/2026 09:00 · Giai đoạn n/total'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD07");
  const r = await seedTimerRun(room.id, "wait");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    await expect(
      strip(u.A).getByRole("listitem").filter({ hasText: "Chờ tới 17/11/2026" }),
    ).toBeVisible();
    await expect(u.A.getByText("Đang chờ hẹn").first()).toBeVisible();
    // Dòng trạng thái (`StatusLine`) nằm ở khung luồng trong phòng (`ProcessFlowContent`), không ở trang /runs/:id.
    await u.A.goto(`/rooms/${room.id}?flow=${r.runId}`);
    await expect(
      u.A.getByRole("status").filter({
        hasText: /Chờ tới 17\/11\/2026 09:00 · Giai đoạn \d+\/\d+ · /,
      }),
    ).toBeVisible();
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-59 · AC-H39 · PD-E08(a) · retry_exhausted ⇒ thẻ quyết: 'Đã thử lại tối đa 3 lần mà vẫn lỗi.', 'Thử lại ngay', 'Huỷ lượt chạy'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD08A");
  const r = await seedPdDecision(room.id, "retry_exhausted");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    const d = decision(u.A);
    await expect(d.getByText("Đã thử lại tối đa 3 lần mà vẫn lỗi.")).toBeVisible();
    await expect(d.getByRole("button", { name: "Thử lại ngay" })).toBeVisible();
    await expect(d.getByRole("button", { name: "Huỷ lượt chạy" })).toBeVisible();
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-59 · AC-H41 · PD-E08(b) · timer_invalid ⇒ thẻ quyết: 'Ngày hẹn không hợp lệ hoặc đã quá hạn lượt chạy.', 'Tính lại ngày hẹn', 'Bỏ chờ, đi tiếp'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD08B");
  const r = await seedPdDecision(room.id, "timer_invalid");
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    const d = decision(u.A);
    await expect(d.getByText("Ngày hẹn không hợp lệ hoặc đã quá hạn lượt chạy.")).toBeVisible();
    await expect(d.getByRole("button", { name: "Tính lại ngày hẹn" })).toBeVisible();
    await expect(d.getByRole("button", { name: "Bỏ chờ, đi tiếp" })).toBeVisible();
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-59 · AC-H42 · PD-E08(c) · task review đã chuyển cấp ⇒ region 'Kiểm …' có 'Đã chuyển cấp'; Inbox của H có thẻ 'Việc ở … đã chuyển cấp tới nhóm của bạn'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD08C");
  const r = await seedEscalated(room.id);
  const u = await users(browser, "H");
  try {
    await u.H.goto("/process-inbox");
    const card = u.H.getByRole("log", { name: "Thông báo quy trình" }).getByRole("article", {
      name: /^Việc ở .* đã chuyển cấp tới nhóm của bạn$/,
    });
    await expect(card).toBeVisible();
    await expect(card.getByRole("region", { name: /^Kiểm / })).toContainText("Đã chuyển cấp");
    expect(r.ready).toBe(true);
  } finally {
    await u.close();
  }
});

test("CHAT-AC-59 · AC-H41 · PD-E08(d) · form '!pd-wait-input': ô ngày (type=date) gửi được, POST mang inputs date", async ({
  browser,
}) => {
  const room = await mkRoom("EPD08D");
  const u = await users(browser, "A");
  const p = u.A;
  try {
    await p.goto(`/rooms/${room.id}`);
    await p.getByRole("button", { name: "Quy trình", exact: true }).click();
    await p
      .getByRole("listbox", { name: "Quy trình" })
      .getByRole("option")
      .filter({ hasText: "!pd-wait-input" })
      .click();
    await expect(roomComposer(p, "nhóm")).toHaveValue("!pd-wait-input ");
    await p.getByRole("button", { name: "Gửi", exact: true }).click();
    const f = p.getByRole("dialog", { name: "Thông tin cho quy trình Chờ nhập ngày" });
    const date = f.getByLabel("Hạn");
    await expect(date).toHaveAttribute("type", "date");
    await date.fill("2026-12-14");
    const req = p.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === "/process-runs",
    );
    await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
    const body = JSON.parse((await req).postData() ?? "{}");
    expect(body.inputs).toEqual(
      expect.arrayContaining([{ type: "date", key: "han", value: "2026-12-14" }]),
    );
  } finally {
    await u.close();
  }
});

test("CHAT-AC-59 · AC-H45 · AC-H47 · PD2-E04 · run có stage nhảy ⇒ dải 'Bỏ qua'; lỗi tool ⇒ vùng 'Cần người quyết' 'Gọi tool bị lỗi.'; thread có tin 'Rẽ nhánh: tới bước 4 (luật 1)'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD2E04");
  const runId = await seedPd2Run(room.id); // tiền đề thiếu ⇒ ném "chưa có tính năng" NGAY
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${runId}`);
    await expect(strip(u.A).getByRole("listitem").filter({ hasText: "Bỏ qua" })).toBeVisible();
    await expect(decision(u.A)).toContainText("Gọi tool bị lỗi.");
    await openThread(u.A, room.id);
    await expect(flowLog(u.A)).toContainText("Rẽ nhánh: tới bước 4 (luật 1)");
  } finally {
    await u.close();
  }
});
