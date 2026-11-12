// CR-118 · cr118-flow-admin · e2e editor quy trình (admin-web `/processes/:id`): bước "Người điền form" — thêm bước + trường ở Canvas,
// Lưu (Hub kiểm FORM_INVALID: `output.fields` phải khớp trường form), Bật (publish), tải lại còn; sửa trường ở view Danh sách.
// Dùng stack của `playwright.fnr.config.ts` (Hub thật + Runtime giả + admin-web). Mỗi ca tự dựng def riêng qua API (key ngẫu nhiên).
import { expect, type Page, test } from "@playwright/test";
import { ACME, ADMIN_URL, hub, platformLogin, platTok, settle } from "../P-a/_pa-support";

test.afterEach(() => settle());

// biome-ignore lint/suspicious/noExplicitAny: json theo contract
type Json = any;
const FNR_GROUP = "f4a00000-0000-4000-8000-000000000001"; // `_seed.ts` (Pháp chế flow mẫu)
const uniq = (p: string) =>
  `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const stage = (
  key: string,
  name: string,
  step: number,
  executor: Json,
  fields: Json[],
  after: Json,
) => ({
  key,
  name,
  step,
  executor,
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: `# ${name}\n\n## Kết quả\n`,
    required_sections: ["Kết quả"],
    fields,
  },
  after,
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 600,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
});
const auto = { kind: "auto", branch: [] };
const review = {
  kind: "review",
  group_id: FNR_GROUP,
  back_to_steps: [],
  remind_every_h: null,
  escalate: null,
  branch: [],
  exclude_starter: false,
};
const setStage = stage(
  "thu-thap",
  "Thu thập",
  0,
  { kind: "set", values: [{ key: "amount", from: { const: 7 } }] },
  [{ key: "amount", type: "number", required: true }],
  auto,
);

async function createDef(prefix: string, stages: Json[]): Promise<string> {
  const key = uniq(prefix);
  const r = await hub(await platTok(), "POST", `/process-defs?tenant_id=${ACME}`, {
    key,
    name: `FNR ${key}`,
    description: "e2e editor form CR-118",
    input_hint: "",
    run_group_ids: [],
    token_budget: null,
    enabled: false,
    sources: [],
    inputs: [],
    stages,
  });
  expect(r.status, `POST /process-defs ${JSON.stringify(r.json).slice(0, 400)}`).toBeLessThan(300);
  return r.json.id as string;
}
const getDef = async (id: string): Promise<Json> => {
  const r = await hub(await platTok(), "GET", `/process-defs/${id}?tenant_id=${ACME}`);
  expect(r.status).toBe(200);
  return r.json;
};

const canvas = (p: Page) => p.getByRole("application", { name: "Canvas quy trình" });
const panel = (p: Page) => p.getByRole("complementary", { name: "Chi tiết bước" });
async function save(p: Page): Promise<{ status: number; json: Json }> {
  const put = p.waitForResponse(
    (r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()),
  );
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  const r = await put;
  return { status: r.status(), json: await r.json().catch(() => null) };
}
const sig = (fs: { key: string; type: string }[]) => fs.map((f) => `${f.key}:${f.type}`).join(",");

test("CR-118 · editor form · Canvas: thêm bước form + trường ⇒ Lưu 200 ⇒ Bật ⇒ tải lại còn, output.fields khớp trường", async ({
  page: p,
}) => {
  const id = await createDef("fnr-form-a", [setStage]);
  await platformLogin(p);
  await p.goto(`${ADMIN_URL}/processes/${id}?company=${ACME}`);
  await expect(canvas(p)).toBeVisible();

  await p.getByRole("button", { name: "Thêm bước", exact: true }).click();
  await panel(p).getByLabel("Tên bước", { exact: true }).fill("Điền hồ sơ");
  await panel(p).getByRole("combobox", { name: "Người thực hiện" }).click();
  await p.getByRole("option", { name: "Người điền form" }).click();
  await expect(panel(p).getByTestId("stage-form-fields")).toBeVisible();
  // bước form luôn chờ người điền: chỉ còn "Duyệt bởi Group", chọn nhóm
  await panel(p).getByRole("combobox", { name: "Phòng ban duyệt" }).click();
  await p.getByRole("option", { name: /Pháp chế/ }).click();

  // chưa có trường ⇒ câu lỗi tiếng Việt hiện ngay (live)
  await expect(panel(p).getByText(/Thêm ít nhất một trường/)).toBeVisible();

  // trường 1: số tiền; trường 2: lựa chọn; trường 3: ngày
  await panel(p).getByRole("button", { name: "Thêm trường" }).click();
  await panel(p).getByLabel("Nhãn trường 1").fill("Số tiền đề nghị");
  await expect(panel(p).getByLabel("Mã trường 1")).toHaveValue("so_tien_de_nghi");
  await panel(p).getByRole("combobox", { name: "Loại trường 1" }).click();
  await p.getByRole("option", { name: "Số tiền (đồng)" }).click();
  await panel(p).getByLabel("Nhỏ nhất (để trống nếu không giới hạn)").fill("1000");
  await panel(p).getByRole("switch", { name: "Trường 1 bắt buộc điền" }).click();

  await panel(p).getByRole("button", { name: "Thêm trường" }).click();
  await panel(p).getByLabel("Nhãn trường 2").fill("Hình thức");
  await panel(p).getByRole("combobox", { name: "Loại trường 2" }).click();
  await p.getByRole("option", { name: "Chọn một" }).click();
  await panel(p).getByLabel("Tên lựa chọn 1").fill("Chuyển khoản");
  await panel(p).getByLabel("Mã lựa chọn 1").fill("ck");
  // lựa chọn trống thứ hai ⇒ lỗi tiếng Việt, rồi xoá
  await panel(p).getByRole("button", { name: "Thêm lựa chọn" }).click();
  await expect(panel(p).getByText(/Mã lựa chọn: chữ thường/)).toBeVisible();
  await panel(p).getByRole("button", { name: "Xoá lựa chọn 2" }).click();

  await panel(p).getByRole("button", { name: "Thêm trường" }).click();
  await panel(p).getByLabel("Nhãn trường 3").fill("Ngày cần");
  await panel(p).getByRole("combobox", { name: "Loại trường 3" }).click();
  await p.getByRole("option", { name: "Ngày" }).click();

  // đổi chỗ: đưa trường 3 lên trước trường 2, rồi trả lại
  await panel(p).getByRole("button", { name: "Chuyển trường 3 lên" }).click();
  await expect(panel(p).getByLabel("Nhãn trường 2")).toHaveValue("Ngày cần");
  await panel(p).getByRole("button", { name: "Chuyển trường 2 xuống" }).click();
  await expect(panel(p).getByLabel("Nhãn trường 2")).toHaveValue("Hình thức");

  const r = await save(p);
  expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200);
  const saved = await getDef(id);
  const form = saved.stages.find((s: Json) => s.executor.kind === "form");
  expect(form, "stage form đã lưu").toBeTruthy();
  expect(form.executor.fields.map((f: Json) => f.key)).toEqual([
    "so_tien_de_nghi",
    "hinh_thuc",
    "ngay_can",
  ]);
  expect(form.executor.fields[0]).toMatchObject({ type: "money", min: 1000, required: true });
  expect(form.executor.fields[1].options).toEqual([{ value: "ck", label: "Chuyển khoản" }]);
  expect(sig(form.output.fields)).toBe("so_tien_de_nghi:number,hinh_thuc:string,ngay_can:date");
  expect(form.after).toMatchObject({ kind: "review", group_id: FNR_GROUP });

  // Bật (publish) ở tab Cấu hình ⇒ Lưu ⇒ tải lại còn
  await p.getByRole("switch", { name: "Bật" }).click();
  expect((await save(p)).status).toBe(200);
  expect((await getDef(id)).enabled).toBe(true);
  await p.reload();
  await expect(canvas(p)).toBeVisible();
  await canvas(p)
    .getByRole("button", { name: /^Bước 2: Điền hồ sơ/ })
    .click();
  await expect(panel(p).getByLabel("Nhãn trường 2")).toHaveValue("Hình thức");
});

test("CR-118 · editor form · Danh sách: sửa trường của bước form có sẵn ⇒ output.fields đồng bộ ⇒ Lưu 200", async ({
  page: p,
}) => {
  const fields = [
    { type: "text", key: "ten", label: "Họ tên", required: true, max_len: 100 },
    { type: "checkbox", key: "dong_y", label: "Đồng ý", required: false },
  ];
  const id = await createDef("fnr-form-b", [
    setStage,
    stage(
      "dien-form",
      "Điền form",
      1,
      { kind: "form", fields },
      [
        { key: "ten", type: "string", required: false },
        { key: "dong_y", type: "string", required: false },
      ],
      review,
    ),
  ]);
  await platformLogin(p);
  await p.goto(`${ADMIN_URL}/processes/${id}?company=${ACME}`);
  await expect(canvas(p)).toBeVisible();
  // CR-121 F9: công tắc chế độ dùng chung `ViewModeToggle` (nút "Danh sách bước"), không còn tab
  await p.getByTestId("flows-view-list").click();
  await p.getByRole("button", { name: /^Bước 2: Điền form/ }).click();
  const box = p.getByTestId("stage-form-fields");
  await expect(box.getByLabel("Nhãn trường 1")).toHaveValue("Họ tên");

  await box.getByRole("button", { name: "Thêm trường" }).click();
  await box.getByLabel("Nhãn trường 3").fill("Ghi chú");
  await box.getByRole("button", { name: "Xoá trường 2" }).click();
  await box.getByRole("combobox", { name: "Loại trường 2" }).click();
  await p.getByRole("option", { name: "Văn bản dài" }).click();

  const r = await save(p);
  expect(r.status, JSON.stringify(r.json).slice(0, 400)).toBe(200);
  const form = (await getDef(id)).stages.find((s: Json) => s.executor.kind === "form");
  expect(form.executor.fields.map((f: Json) => `${f.key}:${f.type}`)).toEqual([
    "ten:text",
    "ghi_chu:textarea",
  ]);
  expect(sig(form.output.fields)).toBe("ten:string,ghi_chu:string");
});
