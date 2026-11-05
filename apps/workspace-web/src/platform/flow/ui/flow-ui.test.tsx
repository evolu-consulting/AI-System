// CR-118 · cr118-flow-web · registry (đủ loại, loại lạ ⇒ Generic), renderer `form`, các trạng thái của FlowPanel (render tĩnh, i18n thật).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  FLOW_REF_MAX_BATCH,
  FLOW_STEP_KINDS,
  type FlowStepView,
  type FlowView,
} from "@ai/contracts/flow";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { SUMMARY_BATCH } from "../hooks/use-flow";
import { FlowPanelBody, type FlowPanelState } from "./FlowPanel";
import FormStep from "./FormStep";
import { RENDERERS, rendererFor } from "./registry";
import { GenericStep } from "./StepRow";
import type { StepContext, StepOverrides } from "./types";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const U = "4d400000-0000-4000-8000-000000000001";
const base = {
  key: "k1",
  name: "Bước một",
  status: "open" as const,
  assignee: { kind: "group" as const, id: U, label: "Pháp chế", head_only: false },
  due_at: null,
  overdue: false,
  escalated: false,
  escalated_to: null,
  decided_by: null,
  decided_at: null,
  decided_as: null,
  feedback: null,
  skip_when: null,
};
const formStep = (label = "Tên <b> & co"): Extract<FlowStepView, { kind: "form" }> => ({
  ...base,
  kind: "form",
  form: {
    fields: [
      { key: "name", label, help: "Gợi ý", type: "text", required: true, max_len: 50 },
      { key: "agree", label: "Đồng ý", type: "checkbox", required: false },
    ],
  },
});
const view = (steps: FlowStepView[], o: Partial<FlowView> = {}): FlowView => ({
  slot: "contracts.intake",
  ref: "r1",
  run: { id: U, mode: "engine", status: "running", snapshot_version: 3 },
  state: "running",
  phase: null,
  note: null,
  attention: null,
  block_reason: null,
  steps,
  tasks: [],
  ...o,
});
const ctxOf = (v: FlowView, withTask: boolean): StepContext => ({
  slot: v.slot,
  refId: v.ref,
  view: v,
  now: Date.parse("2026-11-04T00:00:00Z"),
  taskOf: (k) =>
    withTask && k === "k1" ? { task_id: U, step_key: "k1", kind: "form", actions: [] } : null,
  ...(withTask ? { submitForm: async () => {} } : {}),
});
const body = (state: FlowPanelState, overrides?: StepOverrides) =>
  renderToStaticMarkup(
    <FlowPanelBody state={state} slot="contracts.intake" refId="r1" overrides={overrides} />,
  );

describe("registry", () => {
  test("RENDERERS có đủ mọi loại bước của contract, không thừa", () => {
    expect(Object.keys(RENDERERS).sort()).toEqual([...FLOW_STEP_KINDS].sort());
  });
  test("loại lạ (snapshot cũ) ⇒ GenericStep, kể cả tên trùng thuộc tính Object", () => {
    for (const k of ["zzz", "constructor", "toString", "__proto__"])
      expect(rendererFor(k, undefined)).toBe(GenericStep);
  });
  test("loại đã biết ⇒ renderer của registry · override của khe thắng", () => {
    expect(rendererFor("form", undefined)).toBe(RENDERERS.form as never);
    const mine = (() => null) as never;
    expect(rendererFor("review", { review: mine })).toBe(mine);
    expect(rendererFor("dify", { review: mine })).toBe(RENDERERS.dify as never);
  });
});

describe("summary batch", () => {
  test("trần lô của web = trần của contract (FLOW_REF_MAX_BATCH)", () => {
    expect(SUMMARY_BATCH).toBe(FLOW_REF_MAX_BATCH);
  });
});

describe("GenericStep (loại lạ)", () => {
  test("vẽ tên + trạng thái từ trường nền, không vỡ", () => {
    const weird = { ...base, kind: "quantum", status: "weird" } as unknown as FlowStepView;
    const out = renderToStaticMarkup(
      <GenericStep step={weird} ctx={ctxOf(view([weird]), false)} />,
    );
    expect(out).toContain("Bước một");
    expect(out).toContain('data-kind="quantum"');
    expect(out).toContain("Pháp chế");
  });
});

describe("FormStep", () => {
  test("có task đang mở ⇒ form với ô theo loại trường, nhãn là TEXT (thẻ bị escape), dấu * cho trường bắt buộc, nút Gửi", () => {
    const s = formStep();
    const out = renderToStaticMarkup(<FormStep step={s} ctx={ctxOf(view([s]), true)} />);
    expect(out).toContain('data-flow="form"');
    expect(out).toContain("Tên &lt;b&gt; &amp; co");
    expect(out).not.toContain("<b> &");
    expect(out).toContain('type="checkbox"');
    expect(out).toContain("Gợi ý");
    expect(out).toContain(">Gửi<");
    expect(out).toContain('maxLength="50"');
  });
  test("không có task của người xem (hoặc bước không mở) ⇒ chỉ hiển thị dòng bước, không form", () => {
    const s = formStep();
    expect(renderToStaticMarkup(<FormStep step={s} ctx={ctxOf(view([s]), false)} />)).not.toContain(
      "<form",
    );
    const done = { ...s, status: "passed" as const };
    expect(
      renderToStaticMarkup(<FormStep step={done} ctx={ctxOf(view([done]), true)} />),
    ).not.toContain("<form");
  });
});

describe("FlowPanelBody (trạng thái)", () => {
  const sync: StepOverrides = {
    form: ((p: { step: FlowStepView }) => <li data-x="form">{p.step.name}</li>) as never,
  };
  test("đang tải", () => {
    expect(body({ status: "loading" })).toContain("Đang tải quy trình");
  });
  test("lỗi ⇒ thông báo + nút Thử lại", () => {
    const out = body({ status: "error", onRetry: () => {} });
    expect(out).toContain('role="alert"');
    expect(out).toContain("Không tải được quy trình");
    expect(out).toContain("Thử lại");
  });
  test("không có lượt / không có bước ⇒ không vẽ gì", () => {
    expect(body({ status: "ready", view: null })).toBe("");
    expect(body({ status: "ready", view: view([], { run: null, state: "none" }) })).toBe("");
  });
  test("lượt machine ⇒ LegacyMachineRenderer (không dòng bước)", () => {
    const v = view([formStep()], {
      run: { id: U, mode: "machine", status: null, snapshot_version: null },
    });
    const out = body({ status: "ready", view: v }, sync);
    expect(out).toContain('data-flow="legacy-machine"');
    expect(out).not.toContain("Bước một");
  });
  test("có bước ⇒ danh sách theo thứ tự qua renderer của loại · loại lạ ⇒ Generic", () => {
    const weird = { ...base, key: "w", name: "Lạ", kind: "quantum" } as unknown as FlowStepView;
    const v = view([formStep(), weird]);
    const out = body({ status: "ready", view: v }, sync);
    expect(out).toContain('<ol data-flow-panel="contracts.intake">');
    expect(out.indexOf('data-x="form"')).toBeLessThan(out.indexOf('data-kind="quantum"'));
  });
  test("khe tự đặt khung quanh danh sách", () => {
    const out = renderToStaticMarkup(
      <FlowPanelBody
        state={{ status: "ready", view: view([formStep()]) }}
        slot="s.t"
        refId="r"
        overrides={sync}
        frame={(steps) => <section data-frame="x">{steps}</section>}
      />,
    );
    expect(out).toContain('<section data-frame="x"><li data-x="form">');
  });
});
