// CR-125 · cr125-manual-start-ui · phiếu yêu cầu ở trình sửa flow: qua lại stage ⇄ bản nháp, thêm/gỡ node ở đầu flow, kiểm tại chỗ.
import { describe, expect, test } from "bun:test";
import { startFormOf } from "@ai/contracts/hub-admin";
import type { StageDraft } from "./draft-types";
import { emptyStage, stageToDraft, stageToInput } from "./stage-convert";
import {
  addStartField,
  emptyStartForm,
  relabelStartField,
  startFormErrors,
  startFormToDef,
} from "./start-form";
import {
  addStartFormFirst,
  freshStartStage,
  hasStartForm,
  removeStartForm,
} from "./start-form-ops";

const fresh = () =>
  freshStartStage({ name: "Phiếu yêu cầu", fieldLabel: "Ô 1", flowName: "Đề xuất mua hàng" });
const approve = (): StageDraft => ({
  ...emptyStage(0),
  key: "duyet",
  name: "Duyệt",
  executor: "approve",
  after: "review",
});

describe("start-form (trình sửa)", () => {
  test("mã ô tự sinh từ nhãn (bỏ dấu), không trùng, sửa nhãn thì mã đi theo", () => {
    let f = addStartField(emptyStartForm(), "Tên hàng");
    f = addStartField(f, "Ten hang");
    expect(f.fields.map((x) => x.key)).toEqual(["ten_hang", "ten_hang_2"]);
    f = relabelStartField(f, 0, "Giá dự kiến");
    expect(f.fields[0]?.key).toBe("gia_du_kien");
  });
  test("draft → def → draft giữ nguyên ô, ai được bắt đầu, mẫu tên, def hợp lệ với phiếu của engine", () => {
    const s = fresh();
    const def = stageToInput({ ...s, step: 0 });
    expect(def.node).toBe("core.start-form");
    expect(startFormOf(def)).not.toBeNull();
    const back = stageToDraft(def as never, 0);
    expect(back.startForm?.fields.length).toBe(1);
    expect(startFormToDef(back.startForm as never)).toEqual(def.start_form as never);
  });
  test("thêm node phiếu ở ĐẦU flow đẩy các bước lùi một và đánh lại đích bước, gỡ thì dồn lại", () => {
    const a = { ...approve(), approve: { reject: null, ret: null } };
    const r = addStartFormFirst([a], fresh());
    if (!("stages" in r)) throw new Error("expected stages");
    expect(r.stages.map((s) => [s.node ?? s.executor, s.step])).toEqual([
      ["core.start-form", 0],
      ["approve", 1],
    ]);
    expect(hasStartForm(r.stages)).toBe(true);
    const again = addStartFormFirst(r.stages, fresh());
    expect("stages" in again && again.stages.length).toBe(2);
    const back = removeStartForm(r.stages);
    expect(back.map((s) => [s.executor, s.step])).toEqual([["approve", 0]]);
  });
});

describe("start-form (trình sửa)", () => {
  test("kiểm tại chỗ: cần ≥ 1 ô, nhãn, mã không trùng/không phải mã hệ thống, mẫu tên, nhóm khi chọn nhóm", () => {
    const s = fresh();
    const sf = s.startForm as NonNullable<StageDraft["startForm"]>;
    expect(startFormErrors([s])).toEqual({});
    const bad: StageDraft = {
      ...s,
      startForm: {
        ...sf,
        fields: [
          { ...sf.fields[0], label: "", key: "request_title" },
          { ...sf.fields[0], label: "B", key: "request_title" },
          { ...sf.fields[0], label: "C", key: "x", keyAuto: false },
          { ...sf.fields[0], label: "D", key: "x", keyAuto: false },
        ],
        title: " ",
        starters: "groups",
      } as never,
    };
    const e = startFormErrors([bad]);
    expect(e["stages.0.start_form.fields.0.label"]).toContain("labelRequired");
    expect(e["stages.0.start_form.fields.0.key"]).toContain("START_FIELD_RESERVED");
    expect(e["stages.0.start_form.fields.3.key"]).toContain("keyDup");
    expect(e["stages.0.start_form.title_template"]).toContain("titleRequired");
    expect(e["stages.0.start_form.starters"]).toContain("startersGroups");
    expect(
      startFormErrors([{ ...s, startForm: emptyStartForm() }])["stages.0.start_form.fields"],
    ).toContain("fieldsMin");
  });
});
