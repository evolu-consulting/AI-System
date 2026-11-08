// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: kịch bản demo đọc biến môi trường
// biome-ignore-all lint/suspicious/noExplicitAny: JSON phản hồi API không có kiểu (kịch bản demo)
// CR-125 · cr125-purchase-templates · dựng 3 mẫu «Quy trình mua hàng» trong Thư viện BẰNG GIAO DIỆN quản trị nền tảng (Playwright lái trình
// sửa quy trình: thêm bước, đặt tên, chọn nhóm theo mã, thêm trường form, Trả lại, Lưu, Xuất bản) rồi CHẠY thật từng phần trên trình duyệt,
// mỗi vai một lần đăng nhập, chụp hộp việc / thẻ từng vai và lượt chạy xong vào docs/specs/cr125-purchase-templates/shots/.
// Stack: `UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-templates-stack.ts` (đợi "PT STACK READY").
// Chạy:  UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-templates.ts [build|run|all]
//   build: tạo công ty/nhóm/người (API, phần chuẩn bị) → dựng + xuất bản 3 mẫu bằng UI → gán cho công ty `muahang` → Sao chép để sửa (UI).
//   run:   chạy Phần 1–3 bằng UI từng vai.   Biến: SHOTS_DIR, REBUILD=1 (dựng lại dù đã có mẫu cùng tên).
// Chỉ dữ liệu hư cấu @demo.local; mật khẩu quản trị nền tảng đọc từ SEED_ADMIN_* trong .env.local, không in.
import { chromium, type Locator, type Page } from "@playwright/test";
import { ADMIN_USER, DEMO_PW, TENANT } from "./purchase-flow-data";
import { platformToken, setupTenant } from "./purchase-flow-setup";
import { GROUPS, PHASES, type Phase, type Step } from "./purchase-templates.def";
import { log, loginAdmin, SHOTS, u } from "./purchase-templates.kit";

const TEMPLATE_B1 = "0c122000-0000-4000-8000-0000000000b1"; // mẫu «Duyệt 2 cấp» (UI Thư viện chưa có «quy trình trống»: bắt đầu từ mẫu)

async function hubDelete(id: string, version: number, tok: string): Promise<void> {
  await fetch(`${u.hub}/process-defs/${id}?version=${version}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${tok}` },
  });
}

async function hubGet(path: string, tok: string): Promise<any> {
  const r = await fetch(`${u.hub}${path}`, { headers: { authorization: `Bearer ${tok}` } });
  return r.json();
}

// ───────────────────────── dựng mẫu bằng UI ─────────────────────────

const rows = (p: Page): Locator => p.locator('ol[aria-label="Canvas quy trình"] ul > li');
const panelName = (p: Page): Locator => p.getByLabel("Tên bước", { exact: true });

async function pickOption(p: Page, combo: Locator, label: string | RegExp): Promise<void> {
  await combo.click();
  await p.getByRole("option", { name: label }).first().click();
}

async function addNode(p: Page, which: "form" | "approve" | "esign" | "finish"): Promise<void> {
  await p.getByTestId("flow-add-step").click();
  if (which === "form") await p.getByRole("menuitem", { name: "Điền thông tin" }).click();
  else if (which === "approve") await p.getByTestId("flow-node-approve").click();
  else if (which === "esign") await p.getByTestId("flow-node-contracts.esign").click();
  else await p.getByTestId("flow-node-finish-approved").click();
  await p.waitForTimeout(250);
}

/** Tạo bản nháp Thư viện từ mẫu «Duyệt 2 cấp» (UI «Dùng mẫu này»), mở danh sách bước, xoá hết bước của mẫu cũ. */
async function newDraft(p: Page, ph: Phase): Promise<string> {
  await p.goto(`${u.web}/processes/${TEMPLATE_B1}`);
  await p.getByRole("button", { name: "Dùng mẫu này" }).click();
  await p.getByRole("dialog").getByRole("textbox").fill(ph.name);
  await p.getByRole("dialog").getByRole("button", { name: "Dùng mẫu này" }).click();
  await p.waitForURL(
    (x) => /\/processes\/[0-9a-f-]{36}$/.test(x.pathname) && !x.pathname.includes(TEMPLATE_B1),
  );
  const id = p.url().split("/").at(-1) as string;
  await p.getByTestId("flows-view-list").click();
  // bước cuối cùng không xoá được (flow phải còn ≥ 1 bước) ⇒ xoá nốt sau khi đã thêm bước đầu tiên của mẫu mới
  for (let guard = 0; guard < 30 && (await rows(p).count()) > 1; guard++) {
    await rows(p).first().getByRole("button").first().click();
    await p.getByRole("button", { name: "Xoá bước" }).click();
    await p.waitForTimeout(150);
  }
  return id;
}

async function fillForm(p: Page, s: Extract<Step, { kind: "form" }>): Promise<void> {
  await panelName(p).fill(s.name);
  await pickOption(p, p.getByRole("combobox", { name: "Sau bước này" }), "Duyệt bởi phòng ban");
  await pickOption(p, p.getByRole("combobox", { name: "Phòng ban duyệt" }), groupLabel(s.group));
  for (const [i, fd] of s.fields.entries()) {
    await p.getByRole("button", { name: "Thêm trường" }).last().click();
    const n = i + 1;
    await p.getByLabel(`Nhãn trường ${n}`, { exact: true }).fill(fd.label);
    if (fd.type !== "Văn bản ngắn")
      await pickOption(p, p.getByRole("combobox", { name: `Loại trường ${n}` }), fd.type);
    if (fd.required) await p.getByRole("switch", { name: `Trường ${n} bắt buộc điền` }).click();
  }
}

const GROUP_LABELS: Record<string, string> = Object.fromEntries(Object.values(GROUPS));
const groupLabel = (key: string): RegExp =>
  new RegExp(`^${(GROUP_LABELS[key] ?? key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

async function fillApprove(
  p: Page,
  s: Extract<Step, { kind: "approve" }>,
  stepOf: (id: string) => number,
): Promise<void> {
  await panelName(p).fill(s.name);
  await pickOption(p, p.getByRole("combobox", { name: "Ai duyệt" }), groupLabel(s.group));
  if (s.backTo?.length) {
    await p.getByText("Nâng cao", { exact: true }).last().click();
    for (const t of s.backTo) await p.locator(`[id$="-back-${stepOf(t)}"]`).click();
  }
}

async function buildPhase(p: Page, ph: Phase): Promise<string> {
  const id = await newDraft(p, ph);
  const stepNo = new Map<string, number>();
  let step = 0;
  for (const s of ph.steps) {
    stepNo.set(s.id, step);
    step += s.kind === "esign" ? 2 : 1; // Ký số = gửi + chờ (hai stage nối tiếp)
  }
  for (const [i, s] of ph.steps.entries()) {
    await addNode(p, s.kind);
    if (i === 0) {
      await rows(p).first().getByRole("button").first().click();
      await p.getByRole("button", { name: "Xoá bước" }).click();
      await rows(p).last().getByRole("button").first().click(); // chọn lại bước vừa thêm
    }
    if (s.kind === "form") await fillForm(p, s);
    else if (s.kind === "approve") await fillApprove(p, s, (x) => stepNo.get(x) ?? 0);
    log(`  + ${s.name}`);
  }
  // mô tả quy trình
  await p.getByLabel("Mô tả", { exact: true }).fill(ph.description);
  const put = p.waitForResponse(
    (r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()),
  );
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  const res = await put.catch(async (e) => {
    await p.screenshot({ path: `${SHOTS}/_save-error.png`, fullPage: true });
    const alerts = await p.locator("[role=alert], .text-destructive").allInnerTexts();
    throw new Error(`Lưu không gửi được: ${alerts.join(" | ").slice(0, 800)} (${e})`);
  });
  if (res.status() >= 300) {
    await p.screenshot({ path: `${SHOTS}/_save-error.png`, fullPage: true });
    throw new Error(`Lưu ${ph.key}: ${res.status()} ${(await res.text()).slice(0, 600)}`);
  }
  return id;
}

async function publish(p: Page, id: string): Promise<void> {
  await p.goto(`${u.web}/processes/${id}`);
  await p.getByRole("button", { name: /^Xuất bản v/ }).click();
  await p.getByRole("dialog").getByRole("button", { name: "Xuất bản", exact: true }).click();
  await p.getByText("Đã xuất bản").first().waitFor();
}

/** Quản trị nền tảng: gán mẫu cho công ty (UI ngăn «Quy trình» của công ty). */
async function assignToCompany(p: Page, tenantId: string, name: string): Promise<void> {
  await p.goto(`${u.web}/tenants/${tenantId}?tab=processes`);
  const box = p.getByTestId("company-flows");
  await box.waitFor();
  if ((await box.locator('li[data-testid^="company-flow-"]').filter({ hasText: name }).count()) > 0)
    return;
  const pick = box.getByRole("combobox").first();
  const v = await pick.locator("option", { hasText: name }).first().getAttribute("value");
  await pick.selectOption(v as string);
  await box.getByRole("button", { name: "Gán", exact: true }).click();
  await box.locator('li[data-testid^="company-flow-"]').filter({ hasText: name }).first().waitFor();
}

/** Quản trị công ty: «Sao chép để sửa» mẫu đã gán (UI), chụp danh sách. */
async function copyForCompany(p: Page, tenantId: string, name: string): Promise<void> {
  await p.goto(`${u.web}/tenants/${tenantId}?tab=processes`);
  const box = p.getByTestId("company-flows");
  await box.waitFor();
  const flowRows = box.locator('li[data-testid^="company-flow-"]');
  if ((await flowRows.filter({ hasText: name }).filter({ hasText: "Sao từ" }).count()) > 0) return;
  await flowRows.filter({ hasText: name }).getByRole("button", { name: "Sao chép để sửa" }).click();
  await p.getByTestId("copy-confirm").click();
  await flowRows.filter({ hasText: name }).filter({ hasText: "Sao từ" }).first().waitFor();
}

/** Quản trị công ty: mở bản sao, (Phần 2) chọn người ký = nhóm Giám đốc ở node Ký số, «Lưu và áp dụng» (UI). */
async function applyCopy(p: Page, tenantId: string, ph: Phase): Promise<void> {
  await p.goto(`${u.web}/tenants/${tenantId}?tab=processes`);
  const box = p.getByTestId("company-flows");
  await box.waitFor();
  const row = box
    .locator('li[data-testid^="company-flow-"]')
    .filter({ hasText: ph.name })
    .filter({ hasText: "Sao từ" });
  await row.getByRole("link", { name: "Mở", exact: true }).click();
  const canvas = p.getByRole("application", { name: "Canvas quy trình" });
  await canvas.waitFor();
  if (ph.steps.some((s) => s.kind === "esign")) {
    await canvas
      .getByRole("button", { name: /^Ký số/ })
      .first()
      .click();
    const signers = p.getByText("Người ký phía công ty").locator("..");
    await signers.getByRole("checkbox", { name: /Pháp chế/ }).uncheck();
    await signers.getByRole("checkbox", { name: /Giám đốc/ }).check();
  }
  await p.getByRole("button", { name: "Lưu và áp dụng" }).click();
  await p
    .getByText(/Đã áp dụng|Đang dùng/)
    .first()
    .waitFor({ timeout: 30_000 });
}

export async function build(): Promise<{ tenantId: string }> {
  const { tenantId } = await setupTenant(u);
  const tok = await platformToken(u.api);
  const b = await chromium.launch();
  try {
    const p = await (
      await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "vi-VN" })
    ).newPage();
    await loginAdmin(
      p,
      "platform",
      process.env.SEED_ADMIN_USERNAME ?? "admin",
      process.env.SEED_ADMIN_PASSWORD ?? "",
    );
    const have = (await hubGet("/process-defs?limit=200", tok)).items as {
      id: string;
      name: string;
      stage_count: number;
    }[];
    for (const ph of PHASES) {
      const same = have.filter((d) => d.name === ph.name);
      let done = false;
      for (const d of same) {
        const f = await hubGet(`/process-defs/${d.id}`, tok);
        if (
          !process.env.REBUILD &&
          f.stages?.[0]?.name === ph.steps[0]?.name &&
          f.stages.length > 1
        )
          done = true;
        else await hubDelete(d.id, f.version, tok); // bản nháp dở / dựng lại ⇒ không để hai mẫu trùng tên
      }
      if (done) {
        log(`đã có «${ph.name}» — bỏ qua dựng (REBUILD=1 để dựng lại)`);
        continue;
      }
      log(`dựng «${ph.name}»`);
      const id = await buildPhase(p, ph);
      await publish(p, id);
      log(`  đã xuất bản ${id}`);
    }
    for (const ph of PHASES) await assignToCompany(p, tenantId, ph.name);
    log("đã gán 3 mẫu cho công ty");
    const c = await (
      await b.newContext({ viewport: { width: 1600, height: 1000 }, locale: "vi-VN" })
    ).newPage();
    await loginAdmin(c, TENANT.key, ADMIN_USER, DEMO_PW);
    for (const ph of PHASES) await copyForCompany(c, tenantId, ph.name);
    for (const ph of PHASES) await applyCopy(c, tenantId, ph);
    await c.goto(`${u.web}/tenants/${tenantId}?tab=processes`);
    await c.getByTestId("company-flows").waitFor();
    await c.waitForTimeout(1500);
    await c.screenshot({ path: `${SHOTS}/01-company-flows.png`, fullPage: true });
    log("công ty đã sao chép 3 mẫu");
  } finally {
    await b.close();
  }
  return { tenantId };
}

/** Xuất 3 mẫu ĐÃ DỰNG BẰNG UI ra JSON để seed Thư viện (`seed.cr125-config` đọc tệp này): cùng bước, nhóm theo mã, trường form, «Trả lại». */
export async function exportTemplates(): Promise<void> {
  const tok = await platformToken(u.api);
  const list = (await hubGet("/process-defs?limit=200", tok)).items as {
    id: string;
    name: string;
  }[];
  const out = [];
  for (const ph of PHASES) {
    const id = list.find((d) => d.name === ph.name)?.id;
    if (!id) throw new Error(`chưa có «${ph.name}» — chạy build trước`);
    const d = await hubGet(`/process-defs/${id}`, tok);
    out.push({
      key: ph.key,
      name: d.name,
      description: d.description,
      input_hint: d.input_hint,
      inputs: d.inputs,
      trigger: d.trigger,
      app: d.app,
      stages: d.stages,
    });
  }
  const file = "apps/hub-api/src/modules/processes/library/purchase-templates.data.ts";
  await Bun.write(
    file,
    `// Tự sinh bởi \`bun tools/demo/purchase-templates.ts export\` (3 mẫu «Quy trình mua hàng» dựng bằng UI quản trị nền tảng). Không sửa tay.\n// biome-ignore format: dữ liệu tự sinh, một chuỗi JSON\nexport const PURCHASE_TEMPLATES_JSON = ${JSON.stringify(JSON.stringify(out))};\n`,
  );
  log(`đã xuất ${out.length} mẫu → ${file}`);
}

if (import.meta.main) {
  const mode = process.argv[2] ?? "all";
  if (mode === "build" || mode === "all") log(JSON.stringify(await build()));
  if (mode === "export") await exportTemplates();
  if (mode === "run" || mode === "all") await (await import("./purchase-templates.run")).runAll();
}
