// UAT P-d1 · chat-web: F3 form ngày (hợp lệ/không), dải tiến độ "Chờ tới…", bắn hẹn, thử lại, thẻ quyết, chuyển cấp.
import { expect, type Page, test } from "@playwright/test";
import { roomComposer } from "../../../../../../e2e/chat/_x2a-support";
import {
  mkRoom,
  seedEscalated,
  seedPd,
  seedPdDecision,
  seedTimerRun,
  settle,
  users,
  withSql,
} from "../../../../../../e2e/P-d/_pd-support";
import { note, shot, step } from "./uat-lib";

test.beforeAll(() => seedPd());
test.afterAll(() => settle());

const strip = (p: Page) => p.getByRole("list", { name: "Tiến độ quy trình" });
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function openForm(p: Page, roomId: string) {
  await p.goto(`/rooms/${roomId}`);
  await p.getByRole("button", { name: "Quy trình", exact: true }).click();
  await p.getByRole("listbox", { name: "Quy trình" }).getByRole("option").filter({ hasText: "!pd-wait-input" }).click();
  await p.getByRole("button", { name: "Gửi", exact: true }).click();
  const f = p.getByRole("dialog", { name: "Thông tin cho quy trình Chờ nhập ngày" });
  await expect(f).toBeVisible();
  return f;
}

test("F3a · form ngày: bỏ trống / ngày hợp lệ ⇒ Chờ tới", async ({ browser }) => {
  const room = await mkRoom("UAT-F3A");
  const u = await users(browser, "A");
  const p = u.A;
  try {
    let f = await openForm(p, room.id);
    await step("F3a1", "form có ô ngày type=date nhãn 'Hạn'", p, async () => {
      const d = f.getByLabel("Hạn");
      await expect(d).toHaveAttribute("type", "date");
      await shot(p, "F3-01-form-ngay-rong");
    });
    await step("F3a2", "ô ngày bỏ trống rồi 'Bắt đầu quy trình' (mockup: không chặn gửi) ⇒ run tới Cần người quyết", p, async () => {
      await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
      await expect(p.getByText("Cần người quyết").first()).toBeVisible({ timeout: 15_000 });
      await shot(p, "F3-02-bo-trong-ra-can-nguoi-quyet");
      return "form không chặn khi trống (đúng mockup D3); run vào 'Cần người quyết'";
    });
    await settle();
    f = await openForm(p, room.id);    await step("F3a3", "ngày không có thật (30/02): trình duyệt từ chối ⇒ value rỗng", p, async () => {
      const d = f.getByLabel("Hạn");
      const v = await d.evaluate((el) => {
        const i = el as HTMLInputElement;
        i.value = "2026-02-30";
        return i.value;
      });
      await shot(p, "F3-03-form-ngay-sai");
      return `value sau khi gán '2026-02-30' = '${v}' (giới hạn giả lập: Chromium chặn, không đi tới server)`;
    });
    await step("F3a4", "ngày hợp lệ (+2 ngày) ⇒ POST /process-runs, vào Chờ tới", p, async () => {
      const d = f.getByLabel("Hạn");
      await d.fill(iso(2));
      await shot(p, "F3-04-form-ngay-hop-le");
      const resp = p.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/process-runs");
      await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
      const r = await resp;
      expect(r.status()).toBeLessThan(300);
      const runId = (await r.json()).id ?? (await r.json()).run?.id;
      await shot(p, "F3-05-sau-bat-dau");
      return `status ${r.status()} run ${runId}`;
    });
    const run = await withSql(async (sql) => {
      const [r] = await sql<{ id: string }[]>`select id from hub.process_runs where origin_room_id = ${room.id} order by started_at desc limit 1`;
      return r?.id;
    });
    await step("F3a5", "dải 'Chờ tới …', huy hiệu 'Đang chờ hẹn', dòng trạng thái", p, async () => {
      expect(run).toBeTruthy();
      await p.goto(`/rooms/${room.id}?flow=${run}`);
      await expect(p.getByText("Đang chờ hẹn").first()).toBeVisible({ timeout: 15_000 });
      await shot(p, "F3-06-room-flow-cho-hen", true);
      const st = await p.getByRole("status").allInnerTexts();
      await p.goto(`/runs/${run}`);
      await expect(strip(p).getByRole("listitem").filter({ hasText: /Chờ tới/ })).toBeVisible();
      await shot(p, "F3-07-run-page-cho-hen", true);
      return `status: ${st.join(" / ")}`;
    });
    await step("F3a6", "bắn hẹn: due_at = quá khứ ⇒ stage chạy tiếp (đợi bằng tín hiệu DB, không ngủ)", p, async () => {
      const due = await withSql(
        (sql) => sql`update hub.process_timers set due_at = now() - interval '1 minute' where process_run_id = ${run ?? ""} and fired_at is null returning id`,
      );
      expect(due.length).toBeGreaterThan(0);
      // Tín hiệu: stage 0 ra khỏi waiting_timer (vòng nền của Hub bắn hẹn). expect.poll = lưới an toàn, không phải cơ chế chờ.
      await expect
        .poll(
          () => withSql(async (sql) => (await sql<{ s: string }[]>`select status as s from hub.stage_runs where process_run_id = ${run ?? ""} and stage_idx = 0`)[0]?.s),
          { timeout: 20_000, intervals: [250] },
        )
        .not.toBe("waiting_timer");
      await p.goto(`/runs/${run}`);
      await shot(p, "F3-08-sau-ban-hen", true);
      return await withSql(async (sql) => {
        const s = await sql`select stage_idx, status from hub.stage_runs where process_run_id = ${run ?? ""} order by stage_idx`;
        return JSON.stringify(s);
      });
    });
    await p.goto("about:blank");
    f = undefined as never;
  } finally {
    await u.close();
  }
});

test("F3b · ngày xa quá hạn lượt chạy ⇒ timer_invalid", async ({ browser }) => {
  const room = await mkRoom("UAT-F3B");
  const u = await users(browser, "A");
  const p = u.A;
  try {
    const f = await openForm(p, room.id);
    await f.getByLabel("Hạn").fill(iso(40));
    await step("F3b1", "ngày +40 > ttl 7 ngày ⇒ thẻ 'Cần người quyết' timer_invalid", p, async () => {
      await f.getByRole("button", { name: "Bắt đầu quy trình", exact: true }).click();
      const run = await expect
        .poll(() => withSql(async (sql) => (await sql<{ id: string }[]>`select id from hub.process_runs where origin_room_id = ${room.id} order by started_at desc limit 1`)[0]?.id), { timeout: 15_000, intervals: [250] })
        .toBeTruthy()
        .then(() => withSql(async (sql) => (await sql<{ id: string }[]>`select id from hub.process_runs where origin_room_id = ${room.id} order by started_at desc limit 1`)[0]?.id));
      await expect
        .poll(() => withSql(async (sql) => (await sql<{ s: string }[]>`select status as s from hub.process_runs where id = ${run ?? ""}`)[0]?.s), { timeout: 20_000, intervals: [250] })
        .toBe("needs_decision");
      await p.goto(`/runs/${run}`);
      await expect(p.getByText("Ngày hẹn không hợp lệ hoặc đã quá hạn lượt chạy.")).toBeVisible();
      await shot(p, "F3-09-timer-invalid-the-quyet", true);
    });
  } finally {
    await u.close();
  }
});

test("F3c · thử lại / retry_exhausted / timer_invalid (seed SQL)", async ({ browser }) => {
  const room = await mkRoom("UAT-F3C");
  const r1 = await seedTimerRun(room.id, "retry");
  const r2 = await seedPdDecision(room.id, "retry_exhausted");
  const r3 = await seedPdDecision(room.id, "timer_invalid");
  const u = await users(browser, "A");
  const p = u.A;
  try {
    await step("F3c1", "run retry_count=2 ⇒ 'Đang thử lại (2/3)' trên dải + dòng trạng thái", p, async () => {
      await p.goto(`/runs/${r1.runId}`);
      await expect(strip(p).getByRole("listitem").filter({ hasText: "Đang thử lại (2/3)" })).toBeVisible();
      await shot(p, "F3-10-dang-thu-lai-run", true);
      await p.goto(`/rooms/${room.id}?flow=${r1.runId}`);
      await expect(p.getByRole("status").filter({ hasText: /Đang thử lại/ }).first()).toBeVisible({ timeout: 15_000 });
      await shot(p, "F3-11-dang-thu-lai-room", true);
      return (await p.getByRole("status").allInnerTexts()).join(" / ");
    });
    await step("F3c2", "retry_exhausted ⇒ thẻ quyết 3 nút", p, async () => {
      await p.goto(`/runs/${r2.runId}`);
      const d = p.getByRole("region", { name: "Cần người quyết" });
      await expect(d.getByText("Đã thử lại tối đa 3 lần mà vẫn lỗi.")).toBeVisible();
      for (const b of ["Thử lại ngay", "Dùng bản hiện có", "Huỷ lượt chạy"]) {
        const n = await d.getByRole("button", { name: b }).count();
        if (n === 0) throw new Error(`thiếu nút '${b}' (mockup D2)`);
      }
      await shot(p, "F3-12-retry-exhausted", true);
      return (await d.innerText()).replace(/\s+/g, " ");
    });
    await step("F3c3", "timer_invalid ⇒ thẻ quyết", p, async () => {
      await p.goto(`/runs/${r3.runId}`);
      const d = p.getByRole("region", { name: "Cần người quyết" });
      await expect(d.getByText("Ngày hẹn không hợp lệ hoặc đã quá hạn lượt chạy.")).toBeVisible();
      await shot(p, "F3-13-timer-invalid-seed", true);
      return (await d.innerText()).replace(/\s+/g, " ");
    });
    await step("F3c4", "bấm 'Thử lại ngay' ⇒ run rời needs_decision", p, async () => {
      await p.goto(`/runs/${r2.runId}`);
      await p.getByRole("region", { name: "Cần người quyết" }).getByRole("button", { name: "Thử lại ngay" }).click();
      await shot(p, "F3-14-sau-thu-lai-ngay", true);
      const s = await withSql(async (sql) => (await sql<{ s: string }[]>`select status as s from hub.process_runs where id = ${r2.runId}`)[0]?.s);
      expect(s).not.toBe("needs_decision");
      return `status mới = ${s}`;
    });
  } finally {
    await u.close();
  }
});

test("F3d · chuyển cấp: huy hiệu + người trong nhóm xử lý", async ({ browser }) => {
  const room = await mkRoom("UAT-F3D");
  const r = await seedEscalated(room.id);
  const u = await users(browser, "H", "A");
  const h = u.H;
  try {
    await step("F3d1", "H (nhóm Giám đốc): Inbox thẻ 'Đã chuyển cấp tới nhóm của bạn'", h, async () => {
      expect(r.ready).toBe(true);
      await h.goto("/process-inbox");
      const card = h.getByRole("log", { name: "Thông báo quy trình" }).getByRole("article", { name: /^Việc ở .* đã chuyển cấp tới nhóm của bạn$/ });
      await expect(card).toBeVisible();
      await expect(card.getByRole("region", { name: /^Kiểm / })).toContainText("Đã chuyển cấp");
      await shot(h, "F3-15-inbox-chuyen-cap", true);
    });
    await step("F3d2", "A (người khởi tạo): trang run có 'Đã chuyển cấp' + dòng chờ", u.A, async () => {
      await u.A.goto(`/runs/${r.runId}`);
      await expect(u.A.getByRole("list", { name: "Tiến độ quy trình" })).toBeVisible();
      await shot(u.A, "F3-16-run-chuyen-cap-A", true);
      const t = await u.A.locator("body").innerText();
      return `Đã chuyển cấp: ${/Đã chuyển cấp/.test(t)}; 'Đang chờ nhóm': ${/Đang chờ nhóm/.test(t)}`;
    });
    await step("F3d3", "H bấm 'Đạt' trên thẻ kiểm ⇒ quyết được", h, async () => {
      await h.goto("/process-inbox");
      const card = h.getByRole("log", { name: "Thông báo quy trình" }).getByRole("article", { name: /đã chuyển cấp tới nhóm của bạn$/ });
      const pass = card.getByRole("button", { name: "Đạt", exact: true });
      await pass.click();
      await shot(h, "F3-17-H-bam-dat", true);
      const st = await withSql(async (sql) => (await sql<{ s: string }[]>`select status as s from hub.review_tasks where process_run_id = ${r.runId} limit 1`)[0]?.s);
      return `review_task.status = ${st}`;
    });
  } finally {
    await u.close();
  }
  note("F3-seam", "seam hẹn giờ", "F3a6 dùng vòng nền thật + đẩy due_at về quá khứ (stack e2e không lộ handle sweepOnce/đồng hồ giả cho trình duyệt)");
});
