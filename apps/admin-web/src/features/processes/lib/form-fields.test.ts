// CR-118 · cr118-flow-admin: editor trường node `form` — draft ↔ contract, `output.fields` luôn khớp trường form (Hub FORM_INVALID),
// câu lỗi tiếng Việt, đổi loại / sắp xếp trường.
import { describe, expect, test } from "bun:test";
import {
  FORM_OUTPUT_TYPE,
  FormExecutorSchema,
  type FormField,
  ProcessStageDefSchema,
} from "@ai/contracts/hub-admin";
import viAdmin from "../../../../../../packages/i18n/locales/process/admin.vi.json";
import type { StageDraft } from "./draft-types";
import {
  addField,
  blankField,
  FORM_ERR,
  FORM_PATCH,
  fieldKeyFromLabel,
  formFieldErrors,
  formOutputFields,
  formPatch,
  moveField,
  normalizeForm,
  relabel,
  retype,
} from "./form-fields";
import { emptyStage, stageToDraft, stageToInput } from "./stage-convert";

const FIELDS: FormField[] = [
  { type: "text", key: "ten", label: "Họ tên", required: true, max_len: 100 },
  { type: "textarea", key: "ghi_chu", label: "Ghi chú", required: false, max_len: 2000 },
  {
    type: "number",
    key: "so_luong",
    label: "Số lượng",
    required: false,
    integer: true,
    min: 1,
    max: 9,
  },
  { type: "money", key: "so_tien", label: "Số tiền", required: true, min: 1000, max: 5000000 },
  { type: "date", key: "han", label: "Hạn", required: false },
  {
    type: "select",
    key: "loai",
    label: "Loại",
    required: false,
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  },
  { type: "checkbox", key: "dong_y", label: "Đồng ý", required: true },
  { type: "file_ref", key: "tep", label: "Tệp", required: false, help: "PDF" },
];

const formStageDef = (fields: FormField[]) =>
  ProcessStageDefSchema.parse({
    key: "dien-form",
    name: "Điền form",
    executor: { kind: "form", fields },
    instruction: "",
    output: {
      filename: "dien-form.md",
      template: "# Điền form\n\n## Kết quả\n",
      required_sections: ["Kết quả"],
      fields: fields.map((f) => ({ key: f.key, type: FORM_OUTPUT_TYPE[f.type], required: false })),
    },
    after: { kind: "review", group_id: null, back_to_steps: [] },
    real_action: false,
    answerer: { kind: "starter" },
    token_budget: null,
  });

const sig = (fs: readonly { key: string; type: string }[]) =>
  fs.map((f) => `${f.key}:${f.type}`).join(",");

describe("CR-118 · form-fields · def ↔ draft ↔ input", () => {
  test("8 loại trường đi vòng def → draft → input không mất gì", () => {
    const def = formStageDef(FIELDS);
    const back = stageToInput(stageToDraft(def, 0));
    expect(back.executor).toEqual(def.executor);
    expect(FormExecutorSchema.safeParse(back.executor).success).toBe(true);
    expect(ProcessStageDefSchema.safeParse(back).success).toBe(true);
  });

  test("output.fields khớp trường form (key + kiểu) sau khi thêm / xoá / đổi loại / đổi chỗ", () => {
    let d: StageDraft = { ...stageToDraft(formStageDef(FIELDS), 0) };
    const apply = (list: NonNullable<StageDraft["formFields"]>) => {
      d = { ...d, ...formPatch(list) };
    };
    apply(addField(d.formFields ?? [], "money"));
    apply((d.formFields ?? []).filter((f) => f.key !== "ghi_chu"));
    apply((d.formFields ?? []).map((f) => (f.key === "han" ? retype(f, "number") : f)));
    apply(moveField(d.formFields ?? [], 0, 1));
    const out = stageToInput(d);
    const want = (d.formFields ?? []).map((f) => ({ key: f.key, type: FORM_OUTPUT_TYPE[f.type] }));
    expect(sig(out.output.fields)).toBe(sig(want));
    expect(out.output.fields.every((f) => !f.required)).toBe(true);
    expect(ProcessStageDefSchema.safeParse(out).success).toBe(true);
  });

  test("normalizeForm ép lại fields/template/mục/review dù draft lệch (không để Hub trả FORM_INVALID)", () => {
    const d = stageToDraft(formStageDef(FIELDS.slice(0, 2)), 0);
    const stale: StageDraft = {
      ...d,
      fields: [{ key: "cu", type: "number", required: true }],
      after: "auto",
      real: true,
      template: "x",
      sections: [],
      filename: "SAI",
    };
    const n = normalizeForm(stale);
    expect(sig(n.fields)).toBe("ten:string,ghi_chu:string");
    expect(n.after).toBe("review");
    expect(n.real).toBe(false);
    expect(n.sections).toEqual(["Kết quả"]);
    expect(n.filename).toBe("dien-form.md");
    const plain = emptyStage();
    expect(normalizeForm(plain)).toBe(plain); // không phải form ⇒ giữ nguyên
  });

  test("đổi sang loại form: FORM_PATCH ⇒ review, không hành động thật, chưa có trường", () => {
    expect(FORM_PATCH).toMatchObject({
      executor: "form",
      after: "review",
      real: false,
      fields: [],
    });
    expect(FORM_PATCH.formFields).toEqual([]);
  });
});

describe("CR-118 · form-fields · thao tác trường", () => {
  test("thêm trường: nhãn 'Trường n', mã sinh từ nhãn (bỏ dấu, không trùng)", () => {
    const one = addField([], "text");
    expect(one[0]).toMatchObject({ label: "Trường 1", key: "truong_1", type: "text" });
    expect(fieldKeyFromLabel("Số tiền đặt cọc", [])).toBe("so_tien_dat_coc");
    expect(fieldKeyFromLabel("Đơn giá", ["don_gia"])).toBe("don_gia_2");
    expect(fieldKeyFromLabel("123", [])).toBe("truong_123");
    expect(/^[a-z][a-z0-9_]{0,31}$/.test(fieldKeyFromLabel("x".repeat(80), []))).toBe(true);
  });

  test("đổi nhãn: mã đi theo nhãn tới khi người dùng sửa tay mã", () => {
    const l = relabel(addField([], "text"), 0, "Ngày ký");
    expect(l[0]?.key).toBe("ngay_ky");
    const fixed = [{ ...(l[0] as NonNullable<(typeof l)[0]>), key: "ky", keyAuto: false }];
    expect(relabel(fixed, 0, "Ngày khác")[0]?.key).toBe("ky");
  });

  test("đổi loại giữ mã/nhãn/bắt buộc, đặt lại giới hạn; select có sẵn một lựa chọn trống", () => {
    const f = { ...blankField("text"), key: "k", label: "L", required: true, maxLen: "10" };
    const s = retype(f, "select");
    expect(s).toMatchObject({ key: "k", label: "L", required: true, type: "select" });
    expect(s.options).toHaveLength(1);
    expect(retype(f, "number").maxLen).toBe("200");
  });

  test("đổi chỗ: lên đầu / xuống cuối là không đổi", () => {
    const l = [blankField("text"), blankField("date")];
    expect(moveField(l, 0, -1).map((x) => x.type)).toEqual(["text", "date"]);
    expect(moveField(l, 1, -1).map((x) => x.type)).toEqual(["date", "text"]);
    expect(moveField(l, 1, 1).map((x) => x.type)).toEqual(["text", "date"]);
  });

  test("formOutputFields theo FORM_OUTPUT_TYPE", () => {
    expect(
      formOutputFields([blankField("money"), blankField("date"), blankField("checkbox")]).map(
        (f) => f.type,
      ),
    ).toEqual(["number", "date", "string"]);
  });
});

describe("CR-118 · form-fields · câu lỗi", () => {
  const stage = (formFields: StageDraft["formFields"]): StageDraft => ({
    ...emptyStage(),
    executor: "form",
    formFields,
  });
  const errs = (formFields: StageDraft["formFields"]) => formFieldErrors([stage(formFields)]);
  const ok = (over: Partial<ReturnType<typeof blankField>> = {}) => ({
    ...blankField("text"),
    key: "a",
    label: "A",
    ...over,
  });

  test("hợp lệ ⇒ không lỗi; chưa có trường ⇒ câu 'thêm ít nhất một trường'", () => {
    expect(errs([ok()])).toEqual({});
    expect(errs([])).toEqual({ "stages.0.executor.fields": FORM_ERR.noFields });
  });

  test("mã sai / trùng, nhãn trống hoặc có < >", () => {
    const e = errs([ok(), ok({ label: "<b>x</b>" }), ok({ key: "B", label: "" })]);
    expect(e["stages.0.executor.fields.1.key"]).toBe(FORM_ERR.keyDup);
    expect(e["stages.0.executor.fields.1.label"]).toBe(FORM_ERR.label);
    expect(e["stages.0.executor.fields.2.key"]).toBe(FORM_ERR.key);
    expect(e["stages.0.executor.fields.2.label"]).toBe(FORM_ERR.label);
  });

  test("giới hạn: độ dài, số, tiền, min > max", () => {
    const e = errs([
      ok({ maxLen: "501" }),
      ok({ key: "b", type: "textarea", maxLen: "0" }),
      ok({ key: "c", type: "number", min: "5", max: "1" }),
      ok({ key: "d", type: "money", min: "-1" }),
      ok({ key: "e", type: "money", max: "1.5" }),
      ok({ key: "f", type: "number", min: "abc" }),
    ]);
    const p = (j: number, c: string) => `stages.0.executor.fields.${j}.${c}`;
    expect(e[p(0, "max_len")]).toBe(FORM_ERR.maxLenText);
    expect(e[p(1, "max_len")]).toBe(FORM_ERR.maxLenTextarea);
    expect(e[p(2, "max")]).toBe(FORM_ERR.range);
    expect(e[p(3, "min")]).toBe(FORM_ERR.money);
    expect(e[p(4, "max")]).toBe(FORM_ERR.money);
    expect(e[p(5, "min")]).toBe(FORM_ERR.number);
  });

  test("select: không lựa chọn, mã sai, mã trùng, tên trống", () => {
    const sel = (options: { value: string; label: string }[]) =>
      errs([ok({ type: "select", options })]);
    expect(sel([])["stages.0.executor.fields.0.options"]).toBe(FORM_ERR.optionsMin);
    const e = sel([
      { value: "a", label: "A" },
      { value: "a", label: "" },
      { value: "Bad Value", label: "C" },
    ]);
    const p = (c: string) => `stages.0.executor.fields.0.options.${c}`;
    expect(e[p("1.value")]).toBe(FORM_ERR.optionDup);
    expect(e[p("1.label")]).toBe(FORM_ERR.optionLabel);
    expect(e[p("2.value")]).toBe(FORM_ERR.optionValue);
  });

  test("mọi khoá câu lỗi có câu tiếng Việt thật ở i18n (không để lộ khoá)", () => {
    const err = viAdmin as { process?: unknown } & Record<string, unknown> as unknown as {
      editor: { stage: { form: { err: Record<string, string> } } };
    };
    const msgs = err.editor.stage.form.err;
    for (const k of Object.values(FORM_ERR)) {
      const msg = msgs[k.split(".").pop() as string];
      expect(typeof msg).toBe("string");
      expect((msg as string).length).toBeGreaterThan(10);
    }
  });
});
