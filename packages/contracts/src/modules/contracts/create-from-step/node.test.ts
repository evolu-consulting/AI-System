// CR-125 · cr125-contract-from-step · khai báo node «Tạo hợp đồng từ hồ sơ» + luật ánh xạ args → kế hoạch tạo HĐ (thuần).
import { describe, expect, test } from "bun:test";
import {
  CREATE_FROM_STEP_FILE_MISSING,
  CREATE_FROM_STEP_TITLE_DEFAULT,
  CREATE_FROM_STEP_TOOL,
  CreateFromStepConfigSchema,
  planCreateFromStep,
} from "./config";
import { CREATE_FROM_STEP_NODE } from "./node";

const FILE = "0c125000-0000-4000-8000-0000000000f1";

describe("contracts.create-from-step · khai báo", () => {
  test("khoá + nhãn + một stage tool (nội bộ, không real_action) + đầu ra contract_id", () => {
    expect(CREATE_FROM_STEP_NODE.key).toBe("contracts.create-from-step");
    expect(CREATE_FROM_STEP_NODE.label.vi).toBe("Tạo hợp đồng từ hồ sơ");
    const [s] = CREATE_FROM_STEP_NODE.stages;
    expect(CREATE_FROM_STEP_NODE.stages).toHaveLength(1);
    expect(s?.executor).toMatchObject({ kind: "tool", tool_key: CREATE_FROM_STEP_TOOL });
    expect(s?.real_action).toBeUndefined();
    expect(CREATE_FROM_STEP_NODE.outputs.map((o) => o.key)).toEqual(["contract_id"]);
    expect(CREATE_FROM_STEP_NODE.inputs.find((i) => i.key === "file_id")?.required).toBe(true);
  });

  test("cổng cấu hình: số tiền chuỗi → số, từ chối âm", () => {
    expect(CreateFromStepConfigSchema.safeParse({ amount: "1500000" }).success).toBe(true);
    expect(CreateFromStepConfigSchema.safeParse({ amount: -1 }).success).toBe(false);
  });
});

describe("planCreateFromStep · ánh xạ input_map", () => {
  test("đủ tệp + tên + đối tác + giá trị ⇒ kế hoạch chuẩn hoá", () => {
    const r = planCreateFromStep({
      file_id: FILE.toUpperCase(),
      title: "  HĐ mua máy  ",
      counterparty: " Công ty A ",
      amount: 12_500_000.4,
    });
    expect(r).toEqual({
      ok: true,
      plan: { fileId: FILE, title: "HĐ mua máy", counterparty: "Công ty A", amount: 12_500_000 },
    });
  });

  test("chỉ có tệp ⇒ tên mặc định, đối tác/giá trị null", () => {
    const r = planCreateFromStep({ file_id: FILE });
    expect(r).toEqual({
      ok: true,
      plan: {
        fileId: FILE,
        title: CREATE_FROM_STEP_TITLE_DEFAULT,
        counterparty: null,
        amount: null,
      },
    });
  });

  test("không có tệp / tệp không phải uuid ⇒ CONTRACT_STEP_FILE_MISSING", () => {
    for (const args of [{}, { file_id: "" }, { file_id: "  " }, { file_id: "abc" }, { title: "x" }])
      expect(planCreateFromStep(args)).toEqual({ ok: false, code: CREATE_FROM_STEP_FILE_MISSING });
  });
});
