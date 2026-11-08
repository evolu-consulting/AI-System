// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: kịch bản demo đọc biến môi trường
// biome-ignore-all lint/suspicious/noExplicitAny: JSON phản hồi API không có kiểu (kịch bản demo)
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: vòng điều phối demo, một hàm cho dễ đọc
import { type Browser, chromium, type Page } from "@playwright/test";
// CR-125 · cr125-purchase-templates · CHẠY Phần 1–3 trên trình duyệt, mỗi vai một lần đăng nhập (một trình duyệt, tuần tự) ở Sổ Hợp Tác
// (workspace-web): nhân viên tải «Phiếu đề xuất mua» + «Gửi duyệt» ⇒ từng nhóm mở «Chờ tôi duyệt» + thẻ hợp đồng, DUYỆT / TRẢ LẠI bằng nút
// trên thẻ ⇒ ký số «Ký thử» bằng nút «Ký ngay» ⇒ ảnh từng vai và ảnh lượt chạy xong ở SHOTS.
// CR-125 · cr125-form-step-card: bước «Điền thông tin» (form) cũng làm bằng UI — thẻ HĐ vẽ ô theo loại + ô tải tệp + «Gửi»; không còn gửi bằng API.
import { PDFDocument } from "../../apps/hub-api/node_modules/pdf-lib";
import { ADMIN_USER, DEMO_PW, ROLES, TENANT } from "./purchase-flow-data";
import { login, platformToken } from "./purchase-flow-setup";
import { PHASES, type Phase } from "./purchase-templates.def";
import { log, SHOTS, u } from "./purchase-templates.kit";

type Json = Record<string, any>;
const PORT = Number(process.env.UAT_PORT_BASE ?? 3800);
export const CW = `http://localhost:${PORT + 3}`;
const WEB = `http://localhost:${PORT}`;
const UUID = /\/contracts\/c\/([0-9a-f-]{36})/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(tok: string, base: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${base}${path}`, {
    method,
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, json: (t ? JSON.parse(t) : {}) as Json };
}

export async function tokenOf(user: string): Promise<string> {
  const r = await login(u.api, TENANT.key, user, DEMO_PW);
  if (r.status !== "authenticated") throw new Error(`đăng nhập ${user}: ${String(r.status)}`);
  return String(r.access_token);
}

/** Chuẩn bị công ty (cài đặt, không phải đường nghiệp vụ): vai gói Hợp đồng cho mọi người + bật ký số «Ký thử». */
export async function prepareCompany(): Promise<{ tenantId: string }> {
  const ptok = await platformToken(u.api);
  const ts = (await api(ptok, u.api, "GET", `/admin/tenants?q=${TENANT.key}&limit=50`)).json;
  const tenantId = String(ts.items.find((t: Json) => t.key === TENANT.key).id);
  const packs = (await api(ptok, u.api, "PUT", `/admin/tenants/${tenantId}/packs/contracts`)).json;
  const grp = (role: string) =>
    (packs.groups as Json[] | undefined)?.find((g) => g.role === role)?.group_id;
  if (grp("owner"))
    await api(ptok, u.api, "POST", `/admin/groups/${grp("owner")}/members`, {
      usernames: [ADMIN_USER],
    });
  if (grp("editor"))
    await api(ptok, u.api, "POST", `/admin/groups/${grp("editor")}/members`, {
      usernames: [...new Set(Object.values(ROLES).map((r) => r.user))],
    });
  const es = await api(await tokenOf(ADMIN_USER), u.hub, "PUT", "/pack/contracts/esign/settings", {
    enabled: true,
    default_provider: "selfsign",
  });
  log(`bật ký số «Ký thử»: ${es.status}`);
  return { tenantId };
}

// ───────────────────────── chọn Phần đang chạy (UI quản trị công ty) ─────────────────────────

/** Công ty: chỉ bản sao của Phần `k` đang Bật (cùng một sự kiện «Gửi duyệt» ⇒ chỉ một mẫu chạy). Dùng menu «…» của hàng. */
async function selectPhase(page: Page, tenantId: string, k: number): Promise<void> {
  await page.goto(`${WEB}/tenants/${tenantId}?tab=processes`);
  const box = page.getByTestId("company-flows");
  await box.waitFor();
  const rowOf = (i: number) =>
    box
      .locator('li[data-testid^="company-flow-"]')
      .filter({ hasText: (PHASES[i] as Phase).name })
      .first();
  const states = async () =>
    (
      (await api(await tokenOf(ADMIN_USER), u.hub, "GET", `/tenants/${tenantId}/company-flows`))
        .json.items as Json[]
    )
      .map((f) => `${f.kind}:${f.enabled ? "on" : "off"}`)
      .join(" ");
  log(`  trước khi chọn: ${await states()}`);
  // bật Phần k trước (bản đang Tắt ⇒ «Mở» ⇒ «Lưu và áp dụng»), rồi tắt các Phần khác (menu «…» ⇒ «Tắt»); kiểm bằng API, tối đa 3 lượt
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${WEB}/tenants/${tenantId}?tab=processes`);
    await box.waitFor();
    if ((await rowOf(k).getByTestId("company-flow-more").count()) === 0) {
      await rowOf(k).getByRole("link", { name: "Mở", exact: true }).click();
      await page.getByRole("application", { name: "Canvas quy trình" }).waitFor();
      await page.getByRole("button", { name: "Lưu và áp dụng" }).click();
      await page.waitForTimeout(3000);
      await page.goto(`${WEB}/tenants/${tenantId}?tab=processes`);
      await box.waitFor();
    }
    for (const i of PHASES.keys()) {
      const more = rowOf(i).getByTestId("company-flow-more");
      if (i === k || (await more.count()) === 0) continue;
      const patched = page.waitForResponse(
        (r) => r.request().method() === "PATCH" && r.url().includes("/company-flows/"),
      );
      await more.click();
      await page.getByRole("menuitem", { name: "Tắt", exact: true }).click();
      await patched;
    }
    await page.waitForTimeout(1500);
    const on = (await states()).split(" ").filter((s) => s === "company:on").length;
    if (on === 1) break;
  }
  log(`  sau khi chọn:  ${await states()}`);
  // xác nhận bằng API: đúng MỘT bản Bật (cấu hình Hub nạp lại theo chu kỳ ngắn ⇒ chờ thêm một nhịp trước khi gửi duyệt)
  const list = (
    await api(await tokenOf(ADMIN_USER), u.hub, "GET", `/tenants/${tenantId}/company-flows`)
  ).json.items as Json[];
  const on = list
    .filter((f) => f.enabled && /mua hàng/.test(String(f.name)))
    .map((f) => String(f.name));
  if (on.length !== 1 || !on[0]?.includes((PHASES[k] as Phase).name))
    throw new Error(`Phần ${k + 1}: bản đang Bật không đúng: ${JSON.stringify(on)}`);
  await sleep(6000);
}
// ───────────────────────── phiên của từng vai ─────────────────────────

async function loginAs(b: Browser, user: string): Promise<Page> {
  const page = await (
    await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "vi-VN" })
  ).newPage();
  await page.goto(`${CW}/login`);
  await page.getByRole("textbox", { name: "Mã công ty" }).fill(TENANT.key);
  await page.getByRole("textbox", { name: "Email" }).fill(user);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(DEMO_PW);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL((x) => !x.pathname.startsWith("/login"));
  return page;
}

const card = (cid: string, tok: string) =>
  api(tok, u.hub, "GET", `/pack/contracts/contracts/${cid}/approval`);

/** Bước đang mở của thẻ (hoặc null) + nhóm của nó. */
async function openStep(
  cid: string,
  tok: string,
): Promise<{ step?: Json; esign?: Json; done: boolean; json: Json }> {
  const j = (await card(cid, tok)).json;
  const all = (j.steps as Json[]) ?? [];
  const step = all.find((s) => s.status === "open");
  // Ký số = node module: một dòng, trạng thái nghiệp vụ ở `outcome` (`waiting` = đã gửi, chờ người ký)
  const signing = all.find((s) => s.outcome === "waiting");
  const done = j.step === "done" || j.run_status === "done" || j.run_status === "completed";
  return {
    ...(step ? { step } : {}),
    ...(signing ? { esign: signing } : j.esign ? { esign: j.esign } : {}),
    done,
    json: j,
  };
}

/** Bước form điền bằng GIAO DIỆN thẻ HĐ: ô theo loại + tải tệp (ô `file_ref`) rồi «Gửi» (không còn gửi bằng API). */
async function fillFormUi(page: Page, stepName: string): Promise<void> {
  const form = page.locator('[data-approval="timeline"] form[data-flow="form"]').first();
  await form.waitFor({ timeout: 30_000 });
  for (const f of await form.locator("[data-flow-field]").all()) {
    const file = f.locator('input[type="file"]');
    if (await file.count()) {
      await file.setInputFiles({
        name: "tep-demo.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("hang,so_luong\nmay chu,2\n", "utf8"),
      });
      await f.getByTestId("file-item").waitFor({ timeout: 30_000 });
      continue;
    }
    const input = f.locator("input, textarea").first();
    const mode = (await input.getAttribute("inputmode")) ?? "";
    const type = (await input.getAttribute("type")) ?? "";
    if (type === "checkbox") await input.check();
    else if (mode === "numeric" || mode === "decimal") await input.fill("480000000");
    else if (type === "date") await input.fill("2026-11-20");
    else await input.fill("Mẫu hư cấu");
  }
  await form.getByRole("button", { name: "Gửi", exact: true }).click();
  await page
    .getByTestId(/^flow-step-/)
    .filter({ hasText: stepName })
    .and(page.locator('[data-status="passed"]'))
    .waitFor({ timeout: 60_000 });
}
let TENANT_ID = "";

async function shotInbox(p: Page, file: string): Promise<void> {
  await p.goto(`${CW}/contracts/approvals`);
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${SHOTS}/${file}.png` });
}
async function shotCard(p: Page, cid: string, file: string): Promise<void> {
  await p.goto(`${CW}/contracts/c/${cid}`);
  const tl = p.locator("[data-approval=timeline]");
  await tl.waitFor({ timeout: 30_000 });
  await tl.scrollIntoViewIfNeeded();
  await p.waitForTimeout(800);
  await tl.screenshot({ path: `${SHOTS}/${file}.png` });
}

async function uploadPdf(p: Page, name: string, title: string): Promise<string> {
  await p.goto(`${CW}/contracts/list`);
  const pdf = await PDFDocument.create();
  pdf.addPage([595, 842]).drawText(`${title} (DEMO)`, { x: 50, y: 780, size: 14 });
  await p.locator('input[type="file"]').setInputFiles({
    name,
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await p.getByTestId("upload-confirm").click();
  await p.waitForURL(UUID, { timeout: 60_000 });
  const cid = UUID.exec(p.url())?.[1] ?? "";
  await p.getByRole("button", { name: "Gửi duyệt" }).waitFor({ timeout: 120_000 });
  await p.getByRole("textbox", { name: /^Nhà cung cấp/ }).waitFor();
  await p.waitForTimeout(2500); // AI điền xong ô
  return cid;
}

/** Người duyệt bấm nút trên thẻ (`pass` / `return`); `return` nhập lý do rồi xác nhận. */
async function decide(p: Page, cid: string, action: "pass" | "return", why = ""): Promise<void> {
  await p.goto(`${CW}/contracts/c/${cid}`);
  const btn = p.locator(`[data-approval=${action}]`).first();
  await btn.waitFor({ timeout: 30_000 });
  await btn.click();
  if (action === "return") {
    const box = p.getByRole("textbox").last();
    await box.fill(why);
    await p
      .getByRole("button", { name: /Trả lại/ })
      .last()
      .click();
  }
  await p.waitForTimeout(1500);
}

async function signEsign(p: Page, cid: string): Promise<void> {
  await p.goto(`${CW}/contracts/c/${cid}`);
  const panel = p.getByTestId("esign-panel");
  await panel.waitFor({ timeout: 60_000 });
  await panel.getByRole("button", { name: "Ký ngay" }).click();
  await p.waitForURL(/esign=return/, { timeout: 60_000 });
}

// ───────────────────────── chạy một Phần ─────────────────────────

async function runPhase(b: Browser, k: number, opts: { loop?: boolean } = {}): Promise<string> {
  const ph = PHASES[k] as Phase;
  const tag = `p${k + 1}`;
  const roleOfGroup = new Map(Object.values(ROLES).map((r) => [r.group, r.user]));
  const ptok = await platformToken(u.api);
  const gs = (await api(ptok, u.api, "GET", `/admin/groups?tenant_id=${TENANT_ID}&limit=200`)).json;
  const keyOfId = new Map<string, string>(
    (gs.items as Json[]).map((g) => [g.id as string, g.key as string]),
  );
  const nvTok = await tokenOf(ROLES.nv.user);
  let n = 0;
  const num = () => String(++n).padStart(2, "0");

  const nv = await loginAs(b, ROLES.nv.user);
  const docs = [
    ["phieu-de-xuat-mua.pdf", "PHIEU DE XUAT MUA HANG"],
    ["hop-dong-mua-hang.pdf", "HOP DONG MUA HANG"],
    ["phieu-nhan-hang.pdf", "PHIEU NHAN HANG VA THANH TOAN"],
  ] as const;
  const cid = await uploadPdf(nv, docs[k][0], docs[k][1]);
  log(`${tag}: ${ROLES.nv.display} tải «${docs[k][0]}» ⇒ hợp đồng ${cid}`);
  await nv.screenshot({ path: `${SHOTS}/${tag}-${num()}-nv-tai-len.png`, fullPage: true });
  await nv.getByRole("button", { name: "Gửi duyệt" }).click();
  await nv.waitForTimeout(3000);
  await nv.close();

  let looped = false;
  let signed = false;
  let idle = 0;
  for (let guard = 0; guard < 60 && idle < 25; guard++) {
    const o = await openStep(cid, nvTok);
    if (o.done) break;
    // ký số: bước ký chờ người ký (nhóm Giám đốc)
    if (!o.step && o.esign && !signed) {
      const gd = await loginAs(b, ROLES.gd.user);
      await shotInbox(gd, `${tag}-${num()}-gd-hop-dong-cho-ky`);
      await shotCard(gd, cid, `${tag}-${num()}-gd-the-ky-so`);
      await signEsign(gd, cid);
      await shotCard(gd, cid, `${tag}-${num()}-gd-da-ky`);
      await gd.close();
      signed = true;
      log(`${tag}: ${ROLES.gd.display} bấm «Ký ngay» (Ký thử)`);
      idle = 0;
      continue;
    }
    if (!o.step) {
      idle++;
      await sleep(2000);
      continue;
    }
    const gkey = keyOfId.get(String(o.step.group_id)) ?? "";
    const user = roleOfGroup.get(gkey);
    if (!user) throw new Error(`${tag}: không có vai cho nhóm ${gkey} (bước ${o.step.name})`);
    const name = String(o.step.name);
    const page = await loginAs(b, user);
    await shotInbox(page, `${tag}-${num()}-${user}-hop-viec`);
    await shotCard(page, cid, `${tag}-${num()}-${user}-the`);
    const isForm = ph.steps.find((s) => s.name === name)?.kind === "form";
    if (isForm) {
      await fillFormUi(page, name);
      log(`${tag}: ${user} (${gkey}) điền «${name}» + tệp (UI)`);
    } else if (opts.loop && !looped && /Giám đốc duyệt ngân sách/.test(name)) {
      looped = true;
      await decide(page, cid, "return", "Ngân sách chưa đạt, làm lại bảng so sánh giá");
      log(`${tag}: ${user} TRẢ LẠI «${name}» (UI)`);
    } else {
      await decide(page, cid, "pass");
      log(`${tag}: ${user} (${gkey}) duyệt «${name}» (UI)`);
    }
    await page.close();
    // chờ bước kế
    for (let i = 0; i < 30; i++) {
      const nx = await openStep(cid, nvTok);
      if (
        nx.done ||
        nx.esign ||
        String(nx.step?.name ?? "") !== name ||
        nx.step?.idx !== o.step.idx
      )
        break;
      await sleep(1000);
    }
  }
  const fin = await loginAs(b, ROLES.nv.user);
  await shotCard(fin, cid, `${tag}-99-hoan-tat`);
  await fin.screenshot({ path: `${SHOTS}/${tag}-99-hoan-tat-trang.png`, fullPage: true });
  await fin.close();
  const last = (await openStep(cid, nvTok)).json;
  log(`${tag} KẾT: run_status=${last.run_status} step=${last.step}`);
  return cid;
}

export async function runAll(): Promise<void> {
  const { tenantId } = await prepareCompany();
  TENANT_ID = tenantId;
  const b = await chromium.launch();
  try {
    const admin = await loginAdminCompany(b);
    const only = (process.env.PT_PHASES ?? "1,2,3").split(",").map((x) => Number(x) - 1);
    for (const [k, opts] of [
      [0, { loop: true }],
      [1, {}],
      [2, {}],
    ] as const) {
      if (!only.includes(k)) continue;
      await selectPhase(admin, tenantId, k);
      log(`— chạy Phần ${k + 1}: ${(PHASES[k] as Phase).name}`);
      await runPhase(b, k, opts);
    }
  } finally {
    await b.close();
  }
}

async function loginAdminCompany(b: Browser): Promise<Page> {
  const { loginAdmin } = await import("./purchase-templates.kit");
  const page = await (
    await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "vi-VN" })
  ).newPage();
  await loginAdmin(page, TENANT.key, ADMIN_USER, DEMO_PW);
  return page;
}
