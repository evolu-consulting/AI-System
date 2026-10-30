// ADM-FR-69 · HUB-FR-121/124/125 · PB-R06/R13/R14 · e2e P-b · editor quy trình (admin-web; test-plan §4.6 E-PB08, E-PB09; nhãn
// nguyên văn plan-frontend.md §4, §6). LƯU Ý va chạm nhãn: `button "Thêm trường"` có ở InputsCard VÀ StageOutput ⇒ luôn scope
// trong `region "Thông tin đầu vào"`; `Lưu` lấy theo nút toàn trang (một nút lưu của editor).
import { expect, type Page, test } from "@playwright/test";
import { AGENT } from "../_pb-data";
import {
  adminLogin,
  createDef,
  ED_SOURCES,
  hub,
  seedPb,
  stageDef,
  tok,
  uniqKey,
} from "../_pb-support";

test.beforeAll(() => seedPb());

const sourcesCard = (p: Page) => p.getByRole("region", { name: "Nguồn của quy trình" });
const inputsCard = (p: Page) => p.getByRole("region", { name: "Thông tin đầu vào" });
const stage1 = (p: Page, name: string) => p.getByRole("region", { name: `Giai đoạn 1: ${name}` });
// fnr-editor-drawer (qc, người dùng chốt ngăn chi tiết đóng mặc định 2026-10-29): bấm node giai đoạn 1 để mở ngăn.
const openStage1 = (p: Page, name: string) =>
  p
    .getByRole("application", { name: "Canvas quy trình" })
    .getByRole("button", { name: new RegExp(`^Giai đoạn 1: ${name}`) })
    .click();

async function openDef(p: Page, key: string, name: string): Promise<void> {
  await adminLogin(p);
  await p
    .getByRole("navigation", { name: "Điều hướng chính" })
    .getByRole("link", { name: "Quy trình", exact: true })
    .click();
  await p.getByRole("tab", { name: "Mẫu · chạy thử" }).click(); // CR-105: def tenant không khe/không của gói nằm ở tab này
  await p
    .getByRole("table", { name: "Quy trình" })
    .getByRole("row")
    .filter({ hasText: key })
    .getByRole("link", { name })
    .click();
  await expect(sourcesCard(p)).toBeVisible();
}
async function addSource(p: Page, key: string): Promise<void> {
  await sourcesCard(p).getByRole("combobox", { name: "Thêm nguồn" }).click();
  await p.getByRole("option", { name: key }).click();
  await expect(sourcesCard(p).getByRole("button", { name: `Bỏ nguồn ${key}` })).toBeVisible();
}
const readDef = async (id: string) =>
  (await hub(await tok("Adm"), "GET", `/process-defs/${id}`)).json;
const save = (p: Page) =>
  p.waitForResponse((r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()));

test("ADM-FR-69 · HUB-FR-121 · HUB-FR-124 · HUB-FR-125 · E-PB08 · editor: chọn nguồn cho quy trình, tập con + allowlist cho giai đoạn, must_know, inputs; Lưu ⇒ tải lại còn nguyên", async ({
  browser,
}) => {
  const key = uniqKey("pb-ed");
  const name = `Soạn nguồn ${key}`;
  const { id } = await createDef(key, name);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    await openDef(p, key, name);
    await expect(sourcesCard(p)).toContainText("Quy trình chưa dùng nguồn nào.");
    await addSource(p, "ed-src-1");
    await addSource(p, "ed-src-2");

    await openStage1(p, "Phân tích");
    const s1 = stage1(p, "Phân tích");
    const grp = s1.getByRole("group", { name: "Nguồn của giai đoạn" });
    await grp.getByRole("checkbox", { name: "ed-src-1" }).check();
    await expect(grp.getByRole("checkbox", { name: "ed-src-2" })).not.toBeChecked();
    await s1
      .getByRole("textbox", { name: "Đường dẫn cho phép — ed-src-1" })
      .fill("docs/**/*.md\nsrc/**");
    await expect(
      s1.getByText(
        "Giai đoạn này sẽ bắt buộc có mục “## Nguồn tham chiếu” trong kết quả (tự thêm).",
      ),
    ).toBeVisible();
    await s1
      .getByRole("textbox", { name: "Điều phải biết trước khi làm" })
      .fill("Kỳ kế toán\nMã khách hàng");

    const inp = inputsCard(p);
    await inp.getByRole("button", { name: "Thêm trường" }).click();
    await inp.getByRole("textbox", { name: "Ký hiệu trường" }).fill("repo");
    await inp.getByRole("textbox", { name: "Nhãn hiển thị" }).fill("Kho cần kiểm");
    await inp.getByRole("combobox", { name: "Kiểu trường" }).click();
    await p.getByRole("option", { name: "Nguồn + nhánh" }).click();
    await inp.getByRole("checkbox", { name: "Bắt buộc" }).check();

    const put = save(p);
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    expect((await put).status()).toBe(200);

    const def = await readDef(id);
    expect(def.sources).toEqual(["ed-src-1", "ed-src-2"]);
    expect(def.stages[0].sources).toEqual([
      { source_key: "ed-src-1", allowlist: ["docs/**/*.md", "src/**"] },
    ]);
    expect(def.stages[0].must_know).toEqual(["Kỳ kế toán", "Mã khách hàng"]);
    expect(def.inputs).toEqual([
      { key: "repo", label: "Kho cần kiểm", type: "source_ref", required: true },
    ]);

    await p.reload();
    await expect(sourcesCard(p).getByRole("button", { name: "Bỏ nguồn ed-src-1" })).toBeVisible();
    await expect(sourcesCard(p).getByRole("button", { name: "Bỏ nguồn ed-src-2" })).toBeVisible();
    await openStage1(p, "Phân tích");
    await expect(stage1(p, "Phân tích").getByRole("checkbox", { name: "ed-src-1" })).toBeChecked();
    await expect(
      stage1(p, "Phân tích").getByRole("textbox", { name: "Đường dẫn cho phép — ed-src-1" }),
    ).toHaveValue("docs/**/*.md\nsrc/**");
    await expect(
      stage1(p, "Phân tích").getByRole("textbox", { name: "Điều phải biết trước khi làm" }),
    ).toHaveValue("Kỳ kế toán\nMã khách hàng");
    await expect(inputsCard(p).getByRole("textbox", { name: "Ký hiệu trường" })).toHaveValue(
      "repo",
    );
    await expect(inputsCard(p).getByRole("button", { name: "Xoá trường repo" })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('ADM-FR-69 · HUB-FR-121 · PB-R06 · PB-R14 · E-PB09 · chặn: giai đoạn >5 nguồn (ô thứ 6 disabled), nguồn ngoài quy trình (không có ô), glob "../x", >10 mục must_know, bỏ nguồn đang được giai đoạn dùng', async ({
  browser,
}) => {
  const key = uniqKey("pb-lim");
  const name = `Giới hạn nguồn ${key}`;
  const five = ED_SOURCES.slice(0, 5).map((k) => ({ source_key: k, allowlist: [] as string[] }));
  const { id } = await createDef(key, name, {
    sources: ED_SOURCES,
    stages: [stageDef({ key: "s1", name: "Phân tích", agentId: AGENT.read, sources: five })],
  });
  const before = await readDef(id);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const puts: string[] = [];
  p.on("request", (r) => {
    if (r.method() === "PUT" && /\/process-defs\//.test(r.url())) puts.push(r.url());
  });
  try {
    await openDef(p, key, name);
    await openStage1(p, "Phân tích");
    const s1 = stage1(p, "Phân tích");
    const grp = s1.getByRole("group", { name: "Nguồn của giai đoạn" });
    // (a) tối đa 5 nguồn / giai đoạn
    for (const k of ED_SOURCES.slice(0, 5))
      await expect(grp.getByRole("checkbox", { name: k })).toBeChecked();
    await expect(grp.getByRole("checkbox", { name: "ed-src-6" })).toBeDisabled();
    await expect(s1.getByText("Tối đa 5 nguồn mỗi giai đoạn.")).toBeVisible();
    // (b) nguồn ngoài quy trình không có ô chọn
    await expect(grp.getByRole("checkbox", { name: "app-repo" })).toHaveCount(0);

    // (c) glob không hợp lệ ⇒ lỗi client, không PUT
    const allow = s1.getByRole("textbox", { name: "Đường dẫn cho phép — ed-src-1" });
    await allow.fill("../x");
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(s1.getByText("Mẫu đường dẫn không hợp lệ", { exact: false })).toBeVisible();
    await allow.fill("src/**");

    // (d) must_know 11 mục ⇒ lỗi, không PUT
    const must = s1.getByRole("textbox", { name: "Điều phải biết trước khi làm" });
    await must.fill(Array.from({ length: 11 }, (_, i) => `Mục ${i + 1}`).join("\n"));
    await p.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(s1.getByText("Tối đa 10 mục.")).toBeVisible();
    expect(puts, "không gọi PUT khi còn lỗi client").toHaveLength(0);
    expect((await readDef(id)).version).toBe(before.version);
    await must.fill("Mục 1");

    // (e) bỏ nguồn đang được giai đoạn dùng ⇒ chặn
    await sourcesCard(p).getByRole("button", { name: "Bỏ nguồn ed-src-1" }).click();
    await expect(
      p.getByText("Nguồn ed-src-1 đang được giai đoạn 1 dùng. Bỏ khỏi giai đoạn trước."),
    ).toBeVisible();
    await expect(sourcesCard(p).getByRole("button", { name: "Bỏ nguồn ed-src-1" })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
