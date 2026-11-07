// CR-122 p17 · khoá đầu vào `contract_id` (có `_`): bộ chọn nguồn của node Gọi tool/Nếu/Chờ/Ghi giá trị cho chọn được và kiểm def chấp nhận.
import { describe, expect, test } from "bun:test";
import { InputKeySchema, type ProcessToolItem } from "@ai/contracts/hub-admin";
import { inputOptions } from "../domain/tool-rules";
import { toolErrors } from "./d2-validate";
import type { StageDraft } from "./draft-types";
import { healFlowInputs } from "./flow-def";
import { type InputDraft, validateSourcesPart } from "./sources-form";
import { emptyStage } from "./stage-convert";

const INPUT: InputDraft = {
  uid: "i1",
  key: "contract_id",
  label: "Hợp đồng",
  type: "text",
  required: true,
  options: "",
};
const CATALOG: ProcessToolItem[] = [
  {
    key: "contracts-esign-send",
    name: "Ký số",
    description: "x",
    side_effect: true,
    params: [{ name: "contract_id", type: "text", required: true, description: "HĐ" }],
  } as unknown as ProcessToolItem,
];
const esign: StageDraft = {
  ...emptyStage(0),
  key: "ky-so",
  name: "Ký số",
  executor: "tool",
  real: true,
  tool: {
    key: "contracts-esign-send",
    args: { contract_id: { from: "input", value: "contract_id", kind: "string" } },
  },
};

describe("CR-122 p17 · khoá đầu vào có _", () => {
  test("bộ chọn nguồn 'Thông tin đầu vào' có contract_id", () => {
    const o = inputOptions([INPUT], "text");
    expect(o.map((x) => x.value)).toEqual(["contract_id"]);
    expect(InputKeySchema.safeParse("contract_id").success).toBe(true);
  });
  test("khai input contract_id hợp lệ; tham số tool lấy từ input contract_id không bị báo lỗi", () => {
    const errs: Record<string, string> = {};
    validateSourcesPart({ sources: [], inputs: [INPUT], stages: [] } as never, errs);
    expect(Object.keys(errs).filter((k) => k.startsWith("inputs"))).toEqual([]);
    expect(toolErrors([esign], [INPUT], CATALOG)).toEqual({});
  });
  test("flow theo sự kiện: input cũ contract-id đổi về contract_id; thiếu ⇒ thêm; đã có ⇒ giữ; khoá khác giữ nguyên", () => {
    const def = { app: "contracts", trigger: { event: "contract.submitted" } };
    const old = { key: "contract-id", label: "HĐ", type: "text", required: true } as const;
    const other = { key: "ghi-chu", label: "Ghi chú", type: "text", required: false } as const;
    expect(healFlowInputs([old, other], def).map((i) => i.key)).toEqual(["contract_id", "ghi-chu"]);
    expect(healFlowInputs([other], def).map((i) => i.key)).toEqual(["ghi-chu", "contract_id"]);
    const cur = { ...old, key: "contract_id" };
    expect(healFlowInputs([cur], def)).toEqual([cur]);
    // def không có sự kiện (flow cũ theo khe) ⇒ không đụng
    expect(healFlowInputs([old], { app: "contracts", trigger: null })).toEqual([old]);
    // sau khi đổi, bộ chọn nguồn + kiểm tool thấy contract_id
    const healed = healFlowInputs([old], def).map((i) => ({ ...INPUT, key: i.key }));
    expect(toolErrors([esign], healed, CATALOG)).toEqual({});
  });
  test("input không khai ⇒ nguồn không có thật ⇒ báo (không nới lỏng)", () => {
    expect(Object.keys(toolErrors([esign], [], CATALOG))).toContain(
      "stages.0.executor.args.contract_id",
    );
  });
});
