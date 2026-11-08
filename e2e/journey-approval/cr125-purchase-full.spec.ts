// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: biến e2e/test, không ảnh hưởng cache build
// CR-125 · cr125-purchase-parent · HÀNH TRÌNH THẬT «Quy trình mua hàng» từ đầu đến cuối (stack `playwright.journey.config.ts`, công ty
// `e2e-ms-<hậu tố>`): nhân viên mở «Tạo yêu cầu» → điền phiếu «Đề xuất mua hàng» (tải file báo giá) → Phần 1 (bước điền + duyệt, dòng 3 hai
// nhóm CÙNG duyệt) → Phần 2 (dòng 6 ba nhóm cùng duyệt, Giám đốc, Ký số «Ký thử») → Phần 3 (dòng 10 cùng duyệt, thanh toán) → yêu cầu cha
// «Đã xong». Cấu hình công ty đi đúng đường seed của sản phẩm (`writeCr125Config`: nhóm, mẫu Thư viện, flow «Quy trình mua hàng» đã gán);
// chuẩn bị bằng SQL chỉ phần người dùng thật làm ở màn thành viên nhóm (gán 3 tài khoản e2e vào các nhóm duyệt).
// Bước điền (form) của Phần 1–3 làm bằng thẻ bước điền thật (lát cr125-form-step-card: cùng bộ chọn với `cr125-form-step-card.spec.ts`).
// KHÔNG chạy trong lát này — chạy MỘT lần ở đợt cuối. CHƯA BIẾT: việc của lượt CON không có HĐ có hiện ở «Chờ tôi duyệt» / mở được thẻ không.
import { existsSync, readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  notifyConfigChanged,
  writeCr125Config,
} from "../../apps/hub-api/src/modules/seed/seed.cr125-config";
import { withOwner } from "../support/helpers";
import { type Env, loginCw, U } from "./_journey";

const need = (n: string): string => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} chưa đặt (playwright.journey.config.ts)`);
  return v;
};
const SFX = need("JA_D5_SUFFIX");
const E: Env = {
  cw: need("JA_CW_URL"),
  admin: need("JA_ADMIN_URL"),
  pw: need("JA_USER_PW"),
  adminUser: need("SEED_ADMIN_USERNAME"),
  adminPw: need("SEED_ADMIN_PASSWORD"),
  tenantKey: `e2e-ms-${SFX}`,
  tenantName: `E2E MS ${SFX}`,
};
const FLOW = "Quy trình mua hàng";
const SHOTS = "docs/specs/cr125-purchase-parent";
const shot = async (page: Page, name: string): Promise<void> => {
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
};
const ctxPage = async (browser: import("@playwright/test").Browser): Promise<Page> =>
  (await browser.newContext({ locale: "vi-VN", viewport: { width: 1440, height: 900 } })).newPage();

/** Nhóm duyệt của mẫu → tài khoản e2e (mỗi dòng cùng duyệt có ít nhất hai người khác nhau). */
const MEMBERS: Record<string, string[]> = {
  [U.director]: [
    "nhan-vien-phong-ban",
    "truong-bo-phan",
    "mua-hang",
    "truong-mua-hang",
    "phap-che",
    "giam-doc",
    "kho",
  ],
  [U.accounting]: ["tai-chinh", "ke-toan", "ke-toan-truong", "thu-quy"],
  [U.employee]: ["nhan-vien-phong-ban"],
};

let runUrl = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await withOwner(async (sql) => {
    await sql.begin((tx) => writeCr125Config(tx as never, [E.tenantKey]));
    const rows = Object.entries(MEMBERS).flatMap(([user, groups]) =>
      groups.map((group) => ({ user, group })),
    );
    await sql`insert into admin.group_members (tenant_id, group_id, user_id)
      select tn.id, g.id, u.id
      from admin.tenants tn
      cross join jsonb_to_recordset(${sql.json(rows as never)}::jsonb) as x("user" text, "group" text)
      join admin.groups g on g.tenant_id = tn.id and g.key = x."group"
      join admin.users u on u.tenant_id = tn.id and u.username = x."user"
      where tn.key = ${E.tenantKey}
      on conflict do nothing`;
    // cr126-child-task-visible · như màn thành viên nhóm: báo cache cấu hình ⇒ Hub thấy nhóm mới của người đã đăng nhập (không báo ⇒
    // «Chờ tôi duyệt» trống với mọi người dù việc đã giao cho nhóm).
    await sql.begin((tx) => notifyConfigChanged(tx as never, [E.tenantKey]));
  });
});

const FILE_BODY = Buffer.from("hang,so_luong\nmay chu,2\n", "utf8");
const VALUE_BY_TYPE: Record<string, string> = {
  number: "2",
  date: "2026-11-20",
  text: "Dữ liệu e2e",
};

/**
 * Bước điền (form) trên thẻ — đúng bộ chọn của `cr125-form-step-card.spec.ts`: `form[data-flow="form"]`, ô `[data-flow-field=<khoá>]`,
 * tệp `input[type=file]` + `file-item`, nút «Gửi». Điền mọi ô còn trống (chữ / số / tiền / ngày / tệp) rồi gửi. Trả true nếu có form để gửi.
 */
/** Giá trị điền cho một ô: ô số / tiền của FormStep là input chữ có `inputmode` numeric|decimal (không phải type=number). */
async function valueFor(field: Locator, input: Locator): Promise<string> {
  const type = (await input.getAttribute("type")) ?? "text";
  const numeric = ["numeric", "decimal"].includes((await input.getAttribute("inputmode")) ?? "");
  if (!numeric) return VALUE_BY_TYPE[type] ?? "Dữ liệu e2e";
  return /toán|tiền|giá|chi phí|₫/i.test((await field.textContent()) ?? "") ? "470000000" : "2";
}

async function submitOpenForm(page: Page): Promise<boolean> {
  const form = page.locator('form[data-flow="form"]').first();
  if (!(await form.isVisible())) return false;
  for (const field of await form.locator("[data-flow-field]").all()) {
    const file = field.locator('input[type="file"]');
    if (await file.count()) {
      await file.setInputFiles({ name: "tai-lieu.csv", mimeType: "text/csv", buffer: FILE_BODY });
      await expect(field.getByTestId("file-item")).toContainText("tai-lieu.csv", {
        timeout: 30_000,
      });
      continue;
    }
    const input = field.locator("input, textarea").first();
    if ((await input.count()) === 0 || (await input.inputValue()) !== "") continue;
    await input.fill(await valueFor(field, input));
  }
  await form.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(form).toHaveCount(0, { timeout: 60_000 });
  return true;
}

/**
 * Việc đang chờ người này (hộp «Chờ tôi duyệt» của yêu cầu): mở từng việc ⇒ trang yêu cầu của lượt GỐC (việc của Phần 1/2/3 mở trang của
 * yêu cầu cha, nhìn vào lượt con), làm ngay tại đó: điền form (thẻ bước điền, «Gửi») hoặc bấm «Duyệt» (cùng RunStepActions với thẻ HĐ).
 */
async function actOnWaiting(page: Page): Promise<boolean> {
  const rows = page.getByTestId("requests-waiting-row");
  // danh sách việc tải SAU trang: chờ có danh sách hoặc dòng «không có việc» rồi mới đếm (đếm ngay ⇒ 0 dù có việc)
  const loaded = async () => {
    await page.goto(`${E.cw}/contracts/requests`);
    await expect(
      page.getByTestId("requests-waiting").or(page.getByTestId("requests-waiting-empty")),
    ).toBeVisible({ timeout: 30_000 });
  };
  await loaded();
  let acted = false;
  for (let i = 0; i < (await rows.count()); i++) {
    await loaded();
    if ((await rows.count()) <= i) break;
    await rows.nth(i).click();
    await expect(page.getByTestId("request-page")).toBeVisible({ timeout: 30_000 });
    // việc của lượt con ⇒ chuyển sang trang yêu cầu gốc (cùng URL với trang yêu cầu cha), lượt con nằm lồng dưới lượt cha
    // (người KHÔNG xem được lượt gốc — vd. Tài chính chỉ duyệt dòng 3 của Phần 1 — ở lại trang lượt con; đúng quyền xem)
    await expect(page).toHaveURL(/\/contracts\/requests\/[0-9a-f-]{36}/, { timeout: 30_000 });
    // cr126-child-task-visible-2 · các bước (lượt cha + con) tải SAU khung trang: chờ có lượt rồi mới xem form / nút Duyệt
    await expect(page.locator("[data-run]").first()).toBeVisible({ timeout: 30_000 });
    const approve = page.getByTestId("request-approve").first();
    // form / nút Duyệt chỉ hiện khi danh sách việc của tôi (taskOf) tải xong — SAU khung các bước: chờ một trong hai (không có ⇒ việc đã xong)
    await expect(page.locator('form[data-flow="form"]').first().or(approve))
      .toBeVisible({ timeout: 15_000 })
      .catch(() => undefined);
    if (await submitOpenForm(page)) acted = true;
    else if (await approve.isVisible()) {
      await approve.click();
      // một người ở HAI nhóm của dòng cùng duyệt (vd. Giám đốc: Pháp chế + Trưởng bộ phận) ⇒ nút Duyệt hiện lại cho phần nhóm kia: chờ «đã ghi nhận»
      await expect(page.getByTestId("request-decided")).toBeVisible({ timeout: 30_000 });
      acted = true;
    }
  }
  return acted;
}
/**
 * cr125-fix-parent-timer-2 · CHỈ khi hỏng: in lượt cha + con (trạng thái), stage_runs của cha, hẹn của stage Quy trình con và đuôi log hub
 * (process-timer | subprocess | settle) để chẩn đoán lượt cha đứng `waiting_timer`.
 */
async function dumpParent(): Promise<void> {
  const id = runUrl.split("/").pop() ?? "";
  const out: string[] = [`[dump] runUrl=${runUrl}`];
  await withOwner(async (sql) => {
    const root =
      await sql`select id, status, current_step, current_stage_idx, updated_at from hub.process_runs
      where id::text = ${id} or id = (select process_run_id from hub.stage_runs where id::text = ${id} limit 1)`;
    out.push(`[dump] root ${JSON.stringify(root)}`);
    const pid = (root[0]?.id as string | undefined) ?? id;
    const q = async (name: string, p: Promise<unknown>) =>
      out.push(`[dump] ${name} ${JSON.stringify(await p.catch((e) => ({ err: String(e) })))}`);
    await q(
      "runs",
      sql`select id, status, parent_stage_run_id, parent_attempt, parent_round, current_step, current_stage_idx,
        finished_at, updated_at, decision from hub.process_runs where id = ${pid} or parent_run_id = ${pid}
        order by parent_stage_run_id nulls first`,
    );
    await q(
      "stages",
      sql`select s.process_run_id = ${pid} as parent, s.process_run_id, s.id, s.stage_idx, s.status, s.attempt,
        s.round, s.current_output_id is not null as has_out, s.updated_at from hub.stage_runs s
        where s.process_run_id = ${pid} or s.process_run_id in (select id from hub.process_runs where parent_run_id = ${pid})
        order by 1 desc, s.process_run_id, s.stage_idx`,
    );
    await q(
      "timers",
      sql`select t.process_run_id = ${pid} as parent, t.stage_run_id, t.kind, t.idempotency_key, t.due_at, t.fired_at,
        t.cancelled_at, now() as db_now from hub.process_timers t
        where t.process_run_id = ${pid} or t.process_run_id in (select id from hub.process_runs where parent_run_id = ${pid})
        order by t.due_at`,
    );
    await q(
      "tasks",
      sql`select t.process_run_id, t.id, t.kind, t.status, t.assignee_group_id, s.stage_idx,
        array(select coalesce(a.user_id::text, 'g:' || a.group_id::text) from hub.review_task_assignees a
          where a.task_id = t.id) as assignees
        from hub.review_tasks t join hub.stage_runs s on s.id = t.stage_run_id
        where t.process_run_id in (select id from hub.process_runs where id = ${pid} or parent_run_id = ${pid})
          and t.status = 'open' order by t.created_at`,
    );
    await q(
      "members",
      sql`select u.username, array_agg(g.key order by g.key) as groups from admin.group_members m
        join admin.users u on u.id = m.user_id join admin.groups g on g.id = m.group_id
        where m.tenant_id = (select tenant_id from hub.process_runs where id = ${pid}) group by u.username`,
    );
  }).catch((e) => out.push(`[dump] sql lỗi ${String(e)}`));
  const re = /process-timer|subprocess|settle|kick|error/i;
  for (const ext of ["out", "err"]) {
    const f = `.data/ja-hub/hub.${ext}`;
    const lines = existsSync(f)
      ? readFileSync(f, "utf8")
          .split("\n")
          .filter((l) => re.test(l))
      : [];
    out.push(`[dump] hub.${ext} (${lines.length} dòng khớp, 60 cuối):`, ...lines.slice(-60));
  }
  console.log(out.join("\n"));
}

/** Mỗi người làm hết việc đang chờ mình; true nếu có ai làm được. */
async function actAll(people: readonly Page[]): Promise<boolean> {
  let moved = false;
  for (const p of people) moved = (await actOnWaiting(p)) || moved;
  return moved;
}

// biome-ignore lint/correctness/noEmptyPattern: Playwright cần mẫu fixture rỗng
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && info.title.startsWith("2 ")) await dumpParent();
});

test("1 · nhân viên: Tạo yêu cầu → phiếu «Đề xuất mua hàng» (tải file báo giá) → gửi", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  await emp.getByTestId("nav-contracts-requests").click();
  const item = emp.getByTestId("startable-flow").filter({ hasText: FLOW });
  await expect(item).toBeVisible({ timeout: 60_000 }); // mọi người trong công ty được bắt đầu
  await item.click();
  await emp.getByLabel("Tên hàng").fill("Máy in HP LaserJet");
  await emp.getByLabel("Số lượng").fill("3");
  await emp.getByLabel("Giá dự kiến").fill("12500000");
  await emp.getByLabel("Lý do").fill("Thay máy in cũ của phòng Kinh doanh");
  await emp.getByTestId("req-file-file_bao_gia").setInputFiles({
    name: "bao-gia.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"),
  });
  await expect(emp.getByTestId("req-file-item")).toContainText("bao-gia.pdf");
  await shot(emp, "01-phieu-de-xuat-mua-hang");
  await emp.getByTestId("request-submit").click();
  await expect(emp.getByTestId("request-page")).toBeVisible({ timeout: 60_000 });
  runUrl = emp.url().split("?")[0] ?? "";
  await expect(emp.getByTestId("request-field-ten_hang")).toContainText("Máy in HP LaserJet");
  await emp.context().close();
});

test("2 · Phần 1 → 2 → 3: các thẻ điền / duyệt (dòng 3, 6, 10 hai–ba nhóm cùng duyệt, Giám đốc Ký thử) tới khi yêu cầu cha «Đã xong»", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const emp = await ctxPage(browser);
  await loginCw(emp, E, U.employee);
  const people = [emp];
  for (const user of [U.director, U.accounting]) {
    const p = await ctxPage(browser);
    await loginCw(p, E, user);
    people.push(p);
  }
  const status = emp.getByTestId("request-status");
  let shots = 0;
  let idle = 0;
  for (let round = 0; round < 100; round++) {
    await emp.goto(runUrl);
    if ((await status.getAttribute("data-status")) === "done") break;
    // mỗi người làm hết việc đang chờ mình; dòng cùng duyệt: cả hai nhóm đều có thẻ mở nên mỗi bên bấm «Đạt» phần của mình
    const moved = await actAll(people);
    idle = moved ? 0 : idle + 1;
    if (idle >= 20) break; // không ai có việc 20 vòng liền ⇒ lượt cha kẹt: dừng sớm, afterEach in chẩn đoán
    if (moved && shots < 6) await shot(people[1] as Page, `02-buoc-${++shots}`);
    if (!moved) await emp.waitForTimeout(5_000); // chờ hẹn canh chốt bước cha / lượt con (qc cr125-final-e2e: vòng không ngủ hết 60 lượt trước khi hẹn kịp chạy)
    // không có việc nào ⇒ đang chờ lượt con / hẹn canh chốt bước cha: nạp lại trang ở vòng sau (không ngủ chờ)
  }
  await emp.goto(runUrl);
  await expect(status).toHaveAttribute("data-status", "done", { timeout: 30_000 });
  // toàn bộ chuỗi trên MỘT trang: lượt cha + ba Phần lồng dưới (parent_run_id)
  expect(await emp.locator("[data-run]").count()).toBeGreaterThanOrEqual(4);
  await shot(emp, "03-quy-trinh-mua-hang-da-xong");
  for (const p of people) await p.context().close();
});
