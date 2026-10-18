// UAT P-d2 · chat-web: F6 input Số · F4 run stage tool + rẽ nhánh + skipped + quay lại · F5 lỗi tool · kiểm lại B3/B4/B6.
import { expect, type Page, test } from "@playwright/test";
import { failBtn, passBtn } from "../../../../../../e2e/P-a/_pa-support";
import {
  mkRoom,
  seedEscalated,
  seedTimerRun,
  settle,
  users,
  withSql,
} from "../../../../../../e2e/P-d/_pd-support";
import { UAT, difyCalls, difyQueue, difyReset, seedUat, shot, step } from "./uat-lib";

test.beforeAll(() => seedUat());
test.afterEach(async () => {
  if (process.env.UAT_KEEP) return;
  await settle();
  await difyReset();
});

const strip = (p: Page) => p.getByRole("list", { name: "Tiến độ quy trình" });
const decision = (p: Page) => p.getByRole("region", { name: "Cần người quyết" });

async function openForm(p: Page, roomId: string, key: string, title: string) {
  await p.goto(`/rooms/${roomId}`);
  await p.getByRole("button", { name: "Quy trình", exact: true }).click();
  await p.getByRole("listbox", { name: "Quy trình" }).getByRole("option").filter({ hasText: title }).click();
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
  const f = p.getByRole("dialog", { name: `Thông tin cho quy trình ${title}` });
  await expect(f).toBeVisible();
  return f;
}
/** Điền "Tổng tiền" rồi bắt đầu; trả runId. */
async function startRun(p: Page, roomId: string, key: string, title: string, tong: string): Promise<string> {
  const f = await openForm(p, roomId, key, title);
  await f.getByLabel("Tổng tiền").fill(tong);
  const resp = p.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/process-runs");
  await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
  const r = await resp;
  expect(r.status()).toBeLessThan(300);
  const j = await r.json();
  return j.id ?? j.run?.id ?? j.run_id;
}
const runStatus = (id: string) =>
  withSql(async (sql) => (await sql<{ s: string }[]>`select status as s from hub.process_runs where id = ${id}`)[0]?.s);
const stagesOf = (id: string) =>
  withSql((sql) => sql<{ stage_idx: number; status: string; retry_count: number }[]>`select stage_idx, status, retry_count from hub.stage_runs where process_run_id = ${id} order by stage_idx`);
const waitRun = (id: string, want: string) =>
  expect.poll(() => runStatus(id), { timeout: 30_000, intervals: [250] }).toBe(want);

test("F6 · input kiểu Số ở form khởi chạy", async ({ browser }) => {
  const room = await mkRoom("UAT-F6");
  const u = await users(browser, "A");
  const p = u.A;
  try {
    let f = await openForm(p, room.id, "uat-num", "UAT Nhập số");
    await step("F6a", "ô 'Tổng tiền' type=number", p, async () => {
      await expect(f.getByLabel("Tổng tiền")).toHaveAttribute("type", "number");
      await shot(p, "F6-01-form-so-rong");
    });
    await step("F6b", "giá trị sai (1e) ⇒ báo 'Nhập một số hợp lệ.', không POST", p, async () => {
      const d = f.getByLabel("Tổng tiền");
      await d.click();
      await d.pressSequentially("1e");
      let posted = false;
      p.on("request", (r) => {
        if (r.method() === "POST" && new URL(r.url()).pathname === "/process-runs") posted = true;
      });
      await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
      await shot(p, "F6-02-so-sai");
      const v = await d.evaluate((el) => ({ bad: (el as HTMLInputElement).validity.badInput, msg: (el as HTMLInputElement).validationMessage, val: (el as HTMLInputElement).value }));
      const txt = (await f.innerText()).replace(/\s+/g, " ");
      if (posted) throw new Error("vẫn POST với số sai");
      return `badInput=${v.bad} value='${v.val}' validationMessage(gốc trình duyệt)='${v.msg}'; câu app 'Nhập một số hợp lệ.' hiện=${/Nhập một số hợp lệ\./.test(txt)}`;
    });
    await step("F6c", "số hợp lệ 12500000 ⇒ POST inputs number", p, async () => {
      f = p.getByRole("dialog", { name: "Thông tin cho quy trình UAT Nhập số" });
      await f.getByLabel("Tổng tiền").fill("12500000");
      await shot(p, "F6-03-so-hop-le");
      const req = p.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/process-runs");
      await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
      const body = JSON.parse((await req).postData() ?? "{}");
      expect(body.inputs).toEqual(expect.arrayContaining([{ type: "number", key: "tong-tien", value: "12500000" }]));
      await shot(p, "F6-04-sau-bat-dau");
      return JSON.stringify(body.inputs);
    });
  } finally {
    await u.close();
  }
});

test("F4a · tool xong + rẽ nhánh KHỚP (25 triệu ⇒ bước 4), skipped, nhật ký, quay lại qua bước skipped", async ({ browser }) => {
  const room = await mkRoom("UAT-F4A");
  const u = await users(browser, "A", "B");
  let runId = "";
  try {
    await step("F4a1", "bắt đầu 'UAT Gọi tool' tổng 25000000 ⇒ run tới gate bước 4, bước 2-3 skipped", u.A, async () => {
      runId = await startRun(u.A, room.id, "uat-tool", "UAT Gọi tool", "25000000");
      await waitRun(runId, "waiting_review");
      const st = await stagesOf(runId);
      await u.A.goto(`/runs/${runId}`);
      await expect(strip(u.A).getByRole("listitem").filter({ hasText: "Bỏ qua" })).toHaveCount(2);
      await shot(u.A, "F4-01-run-ret-nhanh-khop", true);
      return JSON.stringify(st);
    });
    await step("F4a2", "output .md của stage tool + fields (so_hd, tong)", u.A, async () => {
      const md = await withSql(async (sql) => {
        const r = await sql<{ content: string; fields: unknown }[]>`select content, fields from hub.process_outputs where process_run_id = ${runId} order by created_at limit 1`;
        return r[0];
      }).catch((e) => ({ err: String(e) }));
      await u.A.goto(`/rooms/${room.id}?flow=${runId}`);
      await shot(u.A, "F4-02-room-flow-nhanh", true);
      return JSON.stringify(md).slice(0, 500);
    });
    await step("F4a3", "nhật ký: 'Rẽ nhánh: tới bước 4 (luật 1)'", u.A, async () => {
      await expect(u.A.getByText("Rẽ nhánh: tới bước 4 (luật 1)").first()).toBeVisible({ timeout: 15_000 });
      await shot(u.A, "F4-03-nhat-ky-re-nhanh", true);
    });
    await step("F4a4", "B (Kế toán) 'Chưa đạt' ⇒ 'Quay lại bước 2' qua các bước skipped", u.B, async () => {
      await u.B.goto(`/runs/${runId}`);
      const c = u.B.getByRole("region", { name: /^Kiểm / }).first();
      await failBtn(c).click();
      const rg = c.getByRole("radiogroup", { name: "Chưa đạt thì…" });
      await rg.getByRole("radio", { name: "Quay lại bước 2" }).check();
      await shot(u.B, "F4-04-quay-lai-buoc-2", true);
      await c.getByRole("textbox", { name: "Góp ý" }).fill("Làm lại từ bước hai");
      await c.getByRole("button", { name: "Gửi chưa đạt" }).click();
      // bước 2,3 (đang skipped) chạy lại ⇒ lại tới gate bước 4
      await expect
        .poll(async () => (await stagesOf(runId)).map((s) => s.status).join(","), { timeout: 40_000, intervals: [300] })
        .toMatch(/^done,done,done,waiting_review$/);
      await u.B.goto(`/runs/${runId}`);
      await shot(u.B, "F4-05-sau-quay-lai", true);
      return JSON.stringify(await stagesOf(runId));
    });
    await step("F4a5", "B 'Đạt' ⇒ run xong", u.B, async () => {
      const c = u.B.getByRole("region", { name: /^Kiểm / }).first();
      await passBtn(c).click();
      await waitRun(runId, "done");
      await u.B.goto(`/runs/${runId}`);
      await shot(u.B, "F4-06-run-xong", true);
    });
  } finally {
    await u.close();
  }
});

test("F4b · rẽ nhánh KHÔNG khớp (5 triệu) ⇒ chạy tuần tự, không skipped", async ({ browser }) => {
  const room = await mkRoom("UAT-F4B");
  const u = await users(browser, "A");
  try {
    await step("F4b1", "tổng 5000000 ⇒ bước 2,3 chạy, dừng ở gate bước 4", u.A, async () => {
      const runId = await startRun(u.A, room.id, "uat-tool", "UAT Gọi tool", "5000000");
      await waitRun(runId, "waiting_review");
      const st = await stagesOf(runId);
      await u.A.goto(`/runs/${runId}`);
      await expect(strip(u.A).getByRole("listitem").filter({ hasText: "Bỏ qua" })).toHaveCount(0);
      await shot(u.A, "F4-07-khong-khop", true);
      return JSON.stringify(st);
    });
  } finally {
    await u.close();
  }
});

test("F5a · lỗi tạm (Dify 503) ⇒ 'Đang thử lại'; B3 khung luồng trong phòng", async ({ browser }) => {
  const room = await mkRoom("UAT-F5A");
  const u = await users(browser, "A");
  try {
    let runId = "";
    await difyQueue(["http503"]);
    await step("F5a1", "503 ⇒ stage tool waiting_timer, dải 'Đang thử lại (1/3)'", u.A, async () => {
      runId = await startRun(u.A, room.id, "uat-tool", "UAT Gọi tool", "5000000");
      await expect
        .poll(async () => (await stagesOf(runId))[0]?.status, { timeout: 30_000, intervals: [250] })
        .toBe("waiting_timer");
      await u.A.goto(`/runs/${runId}`);
      await expect(strip(u.A).getByRole("listitem").filter({ hasText: /Đang thử lại/ })).toBeVisible();
      await shot(u.A, "F5-01-dang-thu-lai", true);
      return JSON.stringify(await stagesOf(runId));
    });
    await step("B3", "B3: khung luồng trong phòng với run retry KHÔNG kẹt skeleton + dòng 'Đang thử lại'", u.A, async () => {
      await u.A.goto(`/rooms/${room.id}?flow=${runId}`);
      await expect(u.A.getByRole("status").filter({ hasText: /Đang thử lại/ }).first()).toBeVisible({ timeout: 15_000 });
      await shot(u.A, "F5-02-B3-room-flow-retry", true);
      return (await u.A.getByRole("status").allInnerTexts()).join(" / ");
    });
    await step("F5a2", "hẹn thử lại bắn (due_at về quá khứ) ⇒ gọi lại, tool xong", u.A, async () => {
      await withSql((sql) => sql`update hub.process_timers set due_at = now() - interval '1 minute' where process_run_id = ${runId} and fired_at is null and kind = 'retry'`);
      await expect
        .poll(async () => (await stagesOf(runId))[0]?.status, { timeout: 30_000, intervals: [250] })
        .toBe("done");
      await u.A.goto(`/runs/${runId}`);
      await shot(u.A, "F5-03-sau-thu-lai", true);
      return `Dify được gọi ${await difyCalls()} lần`;
    });
  } finally {
    await u.close();
  }
});

test("F5b · lỗi nghiệp vụ (Dify 400) ⇒ thẻ quyết tool_failed", async ({ browser }) => {
  const room = await mkRoom("UAT-F5B");
  const u = await users(browser, "A");
  try {
    await difyQueue(["http400"]);
    let runId = "";
    await step("F5b1", "400 ⇒ run needs_decision, thẻ 'Gọi tool bị bị lỗi.'", u.A, async () => {
      runId = await startRun(u.A, room.id, "uat-tool", "UAT Gọi tool", "5000000");
      await waitRun(runId, "needs_decision");
      await u.A.goto(`/runs/${runId}`);
      await expect(decision(u.A)).toContainText("Gọi tool bị lỗi.");
      await shot(u.A, "F5-04-tool-failed-the-quyet", true);
      return (await decision(u.A).innerText()).replace(/\s+/g, " ");
    });
    await step("F5b2", "chọn nút thử lại (nếu có) ⇒ Dify ổn ⇒ tool xong", u.A, async () => {
      const btns = await decision(u.A).getByRole("button").allInnerTexts();
      const b = decision(u.A).getByRole("button", { name: /Thêm \d+ lần làm lại/ }).first();
      if (!(await b.count())) throw new Error(`không có nút thử lại; nút: ${btns.join(" | ")}`);
      await b.click();
      await expect
        .poll(async () => (await stagesOf(runId))[0]?.status, { timeout: 30_000, intervals: [250] })
        .toBe("done");
      await shot(u.A, "F5-05-sau-quyet-thu-lai", true);
      return `nút: ${btns.join(" | ")}`;
    });
  } finally {
    await u.close();
  }
});

test("F5c · tool side_effect: không người Đạt ⇒ tool_failed (D2-49); có người Đạt + lỗi tạm ⇒ không gọi lại", async ({ browser }) => {
  const room = await mkRoom("UAT-F5C");
  const u = await users(browser, "A", "B");
  try {
    await step("F5c1", "uat-se (bước trước tự chạy, def dựng bằng SQL) ⇒ tool_failed, Dify 0 lời gọi", u.A, async () => {
      const runId = await startRun(u.A, room.id, "uat-se", "UAT Tool tác dụng phụ", "5000000");
      await waitRun(runId, "needs_decision");
      await u.A.goto(`/runs/${runId}`);
      await expect(decision(u.A)).toContainText("Gọi tool bị lỗi.");
      await shot(u.A, "F5-06-se-khong-nguoi-dat", true);
      const n = await difyCalls();
      if (n !== 0) throw new Error(`Dify bị gọi ${n} lần (phải 0)`);
      return `Dify gọi ${n} lần`;
    });
    await step("F5c2", "uat-se2: B Đạt, Dify 503 ⇒ tool_failed ngay, không thử lại (đã gửi + side_effect)", u.A, async () => {
      await difyQueue(["http503"]);
      const runId = await startRun(u.A, room.id, "uat-se2", "UAT Tool phụ có người Đạt", "5000000");
      await waitRun(runId, "waiting_review");
      await u.B.goto(`/runs/${runId}`);
      await passBtn(u.B.getByRole("region", { name: /^Kiểm / }).first()).click();
      await waitRun(runId, "needs_decision");
      await u.A.goto(`/runs/${runId}`);
      await expect(decision(u.A)).toContainText("Gọi tool bị lỗi.");
      await shot(u.A, "F5-07-se-503-khong-thu-lai", true);
      const st = await stagesOf(runId);
      return `Dify ${await difyCalls()} lần; stage: ${JSON.stringify(st)}`;
    });
  } finally {
    await u.close();
  }
});

test("B4/B6 · chuyển cấp (seed SQL): thẻ Inbox có nhóm + giờ; trang run người khởi tạo", async ({ browser }) => {
  const room = await mkRoom("UAT-B46");
  await withSql((sql) => sql`delete from hub.process_notices where kind = 'escalated'`);
  const r = await seedEscalated(room.id);
  const u = await users(browser, "H", "A");
  try {
    await step("B6", "Inbox H: thẻ chuyển cấp nêu nhóm + số giờ", u.H, async () => {
      expect(r.ready).toBe(true);
      await u.H.goto("/process-inbox");
      const card = u.H.getByRole("log", { name: "Thông báo quy trình" }).getByRole("article", { name: /đã chuyển cấp tới nhóm của bạn$/ });
      await expect(card).toBeVisible();
      await shot(u.H, "F7-01-B6-inbox-chuyen-cap", true);
      const t = (await card.innerText()).replace(/\s+/g, " ");
      if (!/Giám đốc/.test(t) || !/giờ/.test(t)) throw new Error(`thẻ thiếu nhóm/giờ: ${t}`);
      return t;
    });
    await step("B4", "Trang run của A: 'Đã chuyển cấp' + dòng 'Đang chờ nhóm … (đã chuyển cấp)'", u.A, async () => {
      await u.A.goto(`/runs/${r.runId}`);
      await expect(strip(u.A)).toBeVisible();
      await shot(u.A, "F7-02-B4-run-chuyen-cap-A", true);
      const t = await u.A.locator("body").innerText();
      if (!/Đã chuyển cấp/.test(t) || !/Đang chờ nhóm/.test(t)) throw new Error(`đã chuyển cấp=${/Đã chuyển cấp/.test(t)} đang chờ nhóm=${/Đang chờ nhóm/.test(t)}`);
      await u.A.goto(`/rooms/${room.id}?flow=${r.runId}`);
      await shot(u.A, "F7-03-B4-room-flow", true);
      return "OK";
    });
  } finally {
    await u.close();
  }
});

test("B5-chat · run chờ hẹn / retry dựng SQL (dải trang run)", async ({ browser }) => {
  const room = await mkRoom("UAT-B5");
  const r = await seedTimerRun(room.id, "retry");
  const u = await users(browser, "A");
  try {
    await step("B5c", "dải 'Đang thử lại (2/3)' (seed SQL)", u.A, async () => {
      await u.A.goto(`/runs/${r.runId}`);
      await expect(strip(u.A).getByRole("listitem").filter({ hasText: "Đang thử lại (2/3)" })).toBeVisible();
      await shot(u.A, "F7-04-retry-seed-chat", true);
    });
  } finally {
    await u.close();
  }
});





test("B4/B6-thật · chuyển cấp THẬT (vòng nền Hub): thông báo + thẻ có nhóm + giờ", async ({ browser }) => {
  test.setTimeout(480_000); // vòng nhắc/chuyển cấp của Hub chạy mỗi 300 s (startProcessReminder) — stack e2e không có seam đồng hồ cho trình duyệt
  const room = await mkRoom("UAT-ESC");
  await withSql((sql) => sql`delete from hub.process_notices where kind = 'escalated'`);
  
  const u = await users(browser, "H", "A", "B");
  try {
    let runId = "";
    await step("B6r1", "run uat-esc ⇒ gate; đẩy escalate_at về quá khứ ⇒ Hub chuyển cấp (tín hiệu: escalated_at)", u.A, async () => {
      runId = await startRun(u.A, room.id, "uat-esc", "UAT Chuyển cấp", "1000");
      await waitRun(runId, "waiting_review");
      await withSql((sql) => sql`update hub.review_tasks set escalate_at = now() - interval '1 minute' where process_run_id = ${runId} and status = 'open'`);
      await expect
        .poll(() => withSql(async (sql) => (await sql<{ e: string | null }[]>`select escalated_at::text as e from hub.review_tasks where process_run_id = ${runId} limit 1`)[0]?.e ?? null), { timeout: 400_000, intervals: [1000] })
        .not.toBeNull();
      return "escalated_at đã ghi";
    });
    await step("B6r2", "H (nhóm Giám đốc): Inbox thẻ nêu nhóm + số giờ", u.H, async () => {
      await u.H.goto("/process-inbox");
      const card = u.H.getByRole("log", { name: "Thông báo quy trình" }).getByRole("article", { name: /đã chuyển cấp tới nhóm của bạn$/ }).first();
      await expect(card).toBeVisible();
      await shot(u.H, "F7-05-B6-inbox-chuyen-cap-that", true);
      const t = (await card.innerText()).replace(/\s+/g, " ");
      if (!/Giám đốc/.test(t) || !/24/.test(t)) throw new Error(`thẻ thiếu nhóm/24 giờ: ${t}`);
      return t;
    });
    await step("B4r", "A (người khởi tạo): trang run có 'Đã chuyển cấp' + 'Đang chờ nhóm'", u.A, async () => {
      await u.A.goto(`/runs/${runId}`);
      await expect(strip(u.A)).toBeVisible();
      await shot(u.A, "F7-06-B4-run-chuyen-cap-that-A", true);
      const t = await u.A.locator("body").innerText();
      if (!/Đã chuyển cấp/.test(t) || !/Đang chờ nhóm/.test(t)) throw new Error(`đã chuyển cấp=${/Đã chuyển cấp/.test(t)} đang chờ nhóm=${/Đang chờ nhóm/.test(t)}`);
      return t.replace(/\s+/g, " ").slice(0, 400);
    });
  } finally {
    await u.close();
  }
});









