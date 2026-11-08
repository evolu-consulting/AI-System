// CR-125 · cr125-subprocess-ui · unit: node "Quy trình con" — đổi qua lại executor, chọn quy trình con, đầu vào / kết quả, sổ panel, ô canvas, mã lỗi.
import { describe, expect, test } from "bun:test";
import type { ProcessDef, ProcessDefListItem } from "@ai/contracts/hub-admin";
import { collapseModules } from "../components/canvas/module-cluster";
import type { StageView } from "../components/canvas/stage-view";
import { hasNodePanel, panelRegistry } from "../modules/panel-registry";
import "../modules/register-panels";
import { featureNodeByKey, MODULES } from "@ai/contracts/modules";
import { draftKindOf, feNodeOf } from "../nodes/registry";
import { connectPatch } from "./canvas-connect";
import { emptyStage, stageToDraft, stageToInput } from "./stage-convert";
import {
  type ChildInput,
  childNeeds,
  childOptions,
  childPickable,
  childReturns,
  childStatus,
  emptySubprocess,
  SUBPROCESS_NODE,
  subprocessErrorKey,
  subprocessFromDef,
  subprocessMissing,
  subprocessToDef,
  unmappedRequired,
  withChild,
  withMapping,
} from "./subprocess-form";

const item = (o: Partial<ProcessDefListItem>): ProcessDefListItem =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    key: "mua-hang-p2",
    name: "Mua hàng · Phần 2",
    enabled: false,
    is_template: false,
    stage_count: 6,
    ...o,
  }) as ProcessDefListItem;

describe("executor ⇄ bản nháp", () => {
  test("đi về giữ def_key + input_map; không ánh xạ ⇒ không gửi input_map", () => {
    const p = subprocessFromDef({
      kind: "subprocess",
      def_key: "mua-hang-p2",
      input_map: { po_no: "po_no" },
      branches: [{ on: "rejected", goto_step: 3 }],
    });
    const d = p.subprocess;
    expect(d).toEqual({ defKey: "mua-hang-p2", inputMap: { po_no: "po_no" } });
    expect(p.wait.branches).toEqual([{ on: "rejected", step: 3 }]);
    expect(subprocessToDef(d, p.wait)).toEqual({
      kind: "subprocess",
      def_key: "mua-hang-p2",
      input_map: { po_no: "po_no" },
      branches: [{ on: "rejected", goto_step: 3 }],
    });
    expect(subprocessToDef({ defKey: "x", inputMap: {} })).toEqual({
      kind: "subprocess",
      def_key: "x",
    });
  });

  test("ô ánh xạ trống bị bỏ khi gửi", () => {
    expect(
      subprocessToDef({ defKey: "x", inputMap: { a: "", "": "b", c: "c" } }).input_map,
    ).toEqual({
      c: "c",
    });
  });

  test("stage đi qua stageToDraft / stageToInput nguyên vẹn (node + executor)", () => {
    const base = stageToInput({
      ...emptyStage(0),
      key: "phan_2",
      executor: "subprocess",
      node: SUBPROCESS_NODE,
      name: "Phần 2",
      subprocess: { defKey: "mua-hang-p2", inputMap: { po_no: "po_no" } },
    });
    expect(base.node).toBe(SUBPROCESS_NODE);
    expect(base.executor).toEqual({
      kind: "subprocess",
      def_key: "mua-hang-p2",
      input_map: { po_no: "po_no" },
    } as never);
    const back = stageToDraft(base, 0);
    expect(back.executor).toBe("subprocess");
    expect(back.subprocess).toEqual({ defKey: "mua-hang-p2", inputMap: { po_no: "po_no" } });
    expect(back.node).toBe(SUBPROCESS_NODE);
  });

  test("registry nhận ra loại subprocess; không rẽ nhánh theo luật", () => {
    expect(draftKindOf("subprocess")).toBe("subprocess" as never);
    expect(feNodeOf("subprocess" as never).family).toBe("control");
  });
});

describe("chọn quy trình con", () => {
  test("trạng thái: đã xuất bản · đang bật · nháp; nháp không chọn được", () => {
    expect(childStatus(item({ published_version: 2 }))).toBe("published");
    expect(childStatus(item({ enabled: true }))).toBe("enabled");
    expect(childStatus(item({}))).toBe("draft");
    expect(childPickable(item({}))).toBe(false);
  });

  test("danh sách bỏ chính nó, xếp chọn được lên trước, nháp xuống cuối", () => {
    const opts = childOptions(
      [
        item({ key: "nhap", name: "A nháp" }),
        item({ key: "me", name: "Cha", published_version: 1 }),
        item({ key: "p1", name: "Mua hàng · Phần 1", published_version: 1 }),
        item({ key: "p2", name: "Mua hàng · Phần 2", enabled: true }),
      ],
      "me",
    );
    expect(opts.map((o) => o.key)).toEqual(["p1", "p2", "nhap"]);
    expect(opts.find((o) => o.key === "nhap")?.disabled).toBe(true);
  });

  test("đổi quy trình con xoá ánh xạ cũ; chọn lại cùng quy trình giữ nguyên", () => {
    const d = { defKey: "a", inputMap: { x: "y" } };
    expect(withChild(d, "a")).toBe(d);
    expect(withChild(d, "b")).toEqual({ defKey: "b", inputMap: {} });
    expect(subprocessMissing(emptySubprocess())).toBe(true);
  });
});

describe("cần gì / trả gì", () => {
  const def = {
    inputs: [
      { key: "po_no", label: "Số PO", type: "string", required: true },
      { key: "note", label: "Ghi chú", type: "string", required: false },
    ],
    stages: [
      {
        executor: { kind: "form", fields: [{ key: "received_at", label: "Ngày nhận" }] },
        output: { fields: [{ key: "total", type: "number", required: true }] },
      },
      { executor: { kind: "agent" }, output: { fields: [{ key: "total" }] } },
    ],
  } as unknown as ProcessDef;

  test("cần = đầu vào khai báo; trả = ô kết quả dưới tên sub_<ô>, không trùng", () => {
    expect(childNeeds(def).map((n) => n.key)).toEqual(["po_no", "note"]);
    expect(childReturns(def).map((r) => r.key)).toEqual(["sub_received_at", "sub_total"]);
    expect(childReturns(def)[0]?.label).toBe("Ngày nhận");
    expect(childNeeds(undefined)).toEqual([]);
  });

  test("đầu vào bắt buộc chưa nối được báo ra; nối thì hết", () => {
    const needs: ChildInput[] = childNeeds(def);
    expect(unmappedRequired(needs, emptySubprocess()).map((n) => n.key)).toEqual(["po_no"]);
    expect(unmappedRequired(needs, withMapping(emptySubprocess(), "po_no", "po_no"))).toEqual([]);
    expect(withMapping({ defKey: "a", inputMap: { po_no: "x" } }, "po_no", "").inputMap).toEqual(
      {},
    );
  });
});

describe("panel + canvas + lỗi", () => {
  test("node đã đăng ký panel riêng (một đường sửa)", () => {
    expect(panelRegistry.has(SUBPROCESS_NODE)).toBe(true);
    expect(hasNodePanel({ key: SUBPROCESS_NODE } as never)).toBe(true);
  });

  test("ô canvas: một stage subprocess thành ô module có ba đầu ra của sổ module; Từ chối / Huỷ vẽ cạnh theo branches", () => {
    const v = {
      uid: "s1",
      index: 0,
      step: 0,
      name: "Phần 2",
      backTo: [],
      branch: [],
      ifs: null,
      hasError: false,
      errorKey: null,
      src: { uid: "s1", step: 0, executor: "subprocess", node: SUBPROCESS_NODE },
    } as unknown as StageView;
    const decl = featureNodeByKey(MODULES, SUBPROCESS_NODE);
    const exits = (decl?.exits ?? []).map((x) => ({ key: x.key, label: x.label.vi, on: x.on }));
    const target = {
      ...v,
      uid: "s2",
      index: 1,
      step: 2,
      src: { ...v.src, uid: "s2", step: 2, executor: "agent", node: undefined },
    } as unknown as StageView;
    const from = {
      ...v,
      src: { ...v.src, wait: { branches: [{ on: "rejected", step: 2 }] } },
    } as unknown as StageView;
    const out = collapseModules([from, target], (k) =>
      k === SUBPROCESS_NODE ? { exits } : undefined,
    );
    const m = out.views[0]?.module;
    expect(m?.exits.map((e) => e.key)).toEqual(["done", "rejected", "cancelled"]);
    expect(m?.exits.filter((e) => e.main).map((e) => e.key)).toEqual(["done"]);
    expect(m?.exits.find((e) => e.key === "rejected")?.to).toEqual(["s2"]); // cạnh thật tới ô đích
    expect(m?.exits.find((e) => e.key === "cancelled")?.to).toEqual([]);
  });

  test("kéo cổng Từ chối tới bước sau ⇒ ghi wait.branches; Hoàn tất ⇒ nextStep", () => {
    const st = (uid: string, step: number, executor: string) =>
      ({
        uid,
        step,
        executor,
        real: false,
        ifx: { yes: null, no: null },
        node: executor === "subprocess" ? SUBPROCESS_NODE : undefined,
        wait: {},
      }) as never;
    const stages = [st("a", 0, "subprocess"), st("b", 1, "agent"), st("c", 2, "agent")];
    const r = connectPatch(stages, {
      source: "a",
      target: "c",
      sourceHandle: "exit:rejected:rejected",
    });
    expect(r).toMatchObject({
      ok: true,
      field: "exit",
      patch: { wait: { branches: [{ on: "rejected", step: 2 }] } },
    });
    const done = connectPatch(stages, { source: "a", target: "c", sourceHandle: "exit:done" });
    expect(done).toMatchObject({ ok: true, field: "next", patch: { nextStep: 2 } });
  });
  test("mã lỗi quy trình con → khoá i18n; mã khác → null", () => {
    expect(subprocessErrorKey("SUBPROCESS_CYCLE")).toBe("process.admin.apiError.SUBPROCESS_CYCLE");
    expect(subprocessErrorKey("SUBPROCESS_DEPTH")).toBe("process.admin.apiError.SUBPROCESS_DEPTH");
    expect(subprocessErrorKey("PROCESS_NOT_FOUND")).toBeNull();
    expect(subprocessErrorKey(null)).toBeNull();
  });
});
