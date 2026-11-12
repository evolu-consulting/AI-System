// CR-127 · U2 · outline-edit: bản nháp ⇄ cây, chèn / xoá / đổi chỗ, bổ sung Hoàn tất.
import { describe, expect, test } from "bun:test";
import { resolveSteps } from "@ai/contracts/hub-admin";
import { FLOW_TEMPLATES } from "./__fixtures__/flow-fixtures";
import type { StageDraft } from "./draft-types";
import { isUnsupported, type Outline, outlineNodes } from "./outline";
import {
  draftFromOutline,
  ensureEnds,
  insertNodes,
  moveNode,
  nodeFromDraft,
  outlineOfDraft,
  removeNode,
  takenKeys,
} from "./outline-edit";
import { withDefaultEnds } from "./outline-ends";
import { emptyStage, stageToDraft } from "./stage-convert";
import { addStartFormFirst, freshStartStage } from "./start-form-ops";

const sample = (): StageDraft[] => {
  const t = FLOW_TEMPLATES.find((x) => !isUnsupported(stagesOf(x))) ?? FLOW_TEMPLATES[0];
  const defs = (t as (typeof FLOW_TEMPLATES)[number]).stages() as never[];
  const steps = resolveSteps(defs);
  return defs.map((d, i) => stageToDraft(d, steps[i] as number));
};
const stagesOf = (t: (typeof FLOW_TEMPLATES)[number]) => {
  const defs = t.stages() as never[];
  const steps = resolveSteps(defs);
  return outlineOfDraft(defs.map((d, i) => stageToDraft(d, steps[i] as number)));
};

describe("CR-127 U2 · outline-edit", () => {
  test("bản nháp ⇒ cây ⇒ bản nháp giữ uid + số bước", () => {
    const d = sample();
    const o = outlineOfDraft(d);
    if (isUnsupported(o)) throw new Error(o.reason);
    const back = draftFromOutline(d, o);
    expect(back.map((s) => s.key)).toEqual(d.map((s) => s.key));
    expect(back.map((s) => s.uid)).toEqual(d.map((s) => s.uid));
  });

  test("chèn một bước vào đầu đường chính rồi xoá ⇒ về cây cũ", () => {
    const d = sample();
    const o0 = outlineOfDraft(d);
    if (isUnsupported(o0)) throw new Error(o0.reason);
    const o = withDefaultEnds(o0);
    const fresh = nodeFromDraft(
      { ...emptyStage(), name: "Thông báo mới", executor: "notify" },
      takenKeys(o),
    );
    const o1 = insertNodes(o, null, 0, [fresh]);
    expect(outlineNodes(o1).length).toBe(outlineNodes(o).length + 1);
    const o2 = removeNode(o1, fresh.stage.key);
    expect(outlineNodes(o2).map((n) => n.stage.key)).toEqual(
      outlineNodes(o).map((n) => n.stage.key),
    );
  });

  test("Hoàn tất cố định cuối: không chèn sau, không đổi chỗ, không xoá", () => {
    const d = sample();
    const o0 = outlineOfDraft(d);
    if (isUnsupported(o0)) throw new Error(o0.reason);
    const o = withDefaultEnds(o0);
    const fresh = nodeFromDraft({ ...emptyStage(), name: "X", executor: "notify" }, takenKeys(o));
    const o1 = insertNodes(o, null, 999, [fresh]);
    expect(o1.items.at(-1)?.kind).toBe("end");
    const endKey = (o1.items.at(-1) as { stage: { key: string } }).stage.key;
    expect(removeNode(o1, endKey).items.at(-1)?.stage.key).toBe(endKey);
    expect(moveNode(o1, endKey, -1).items.at(-1)?.stage.key).toBe(endKey);
  });

  test("moveNode đổi chỗ hai bước kề", () => {
    const d = sample();
    const o0 = outlineOfDraft(d);
    if (isUnsupported(o0)) throw new Error(o0.reason);
    const o = withDefaultEnds(o0);
    const a = nodeFromDraft({ ...emptyStage(), name: "A", executor: "notify" }, takenKeys(o));
    const b = nodeFromDraft({ ...emptyStage(), name: "B", executor: "notify" }, [
      ...takenKeys(o),
      a.stage.key,
    ]);
    const o1 = insertNodes(o, null, 0, [a, b]);
    const o2 = moveNode(o1, a.stage.key, 1);
    expect(o2.items[0]?.stage.key).toBe(b.stage.key);
    expect(o2.items[1]?.stage.key).toBe(a.stage.key);
  });

  test("ensureEnds: đủ rồi ⇒ null; thiếu Hoàn tất ⇒ thêm", () => {
    const d = sample();
    const once = ensureEnds(d);
    const base = once ?? d;
    expect(ensureEnds(base)).toBeNull();
  });
});

describe("CR-127 U2b · Lên / Xuống / Xoá", () => {
  const withTwo = () => {
    const d = sample();
    const o0 = outlineOfDraft(d);
    if (isUnsupported(o0)) throw new Error(o0.reason);
    const o = withDefaultEnds(o0);
    const a = nodeFromDraft({ ...emptyStage(), name: "A", executor: "notify" }, takenKeys(o));
    const b = nodeFromDraft({ ...emptyStage(), name: "B", executor: "notify" }, [
      ...takenKeys(o),
      a.stage.key,
    ]);
    return { o: insertNodes(o, null, 0, [a, b]), a, b };
  };
  test("Xuống rồi Lên trả về thứ tự cũ", () => {
    const { o, a } = withTwo();
    const back = moveNode(moveNode(o, a.stage.key, 1), a.stage.key, -1);
    expect(back.items.map((n) => n.stage.key)).toEqual(o.items.map((n) => n.stage.key));
  });
  test("Lên ở đầu danh sách không đổi gì", () => {
    const { o, a } = withTwo();
    expect(moveNode(o, a.stage.key, -1).items.map((n) => n.stage.key)).toEqual(
      o.items.map((n) => n.stage.key),
    );
  });
  test("Xoá một bước ⇒ bản nháp lưu được và không còn mã đó", () => {
    const { o, a } = withTwo();
    const d = sample();
    const next = draftFromOutline(d, removeNode(o, a.stage.key));
    expect(next.some((s) => s.key === a.stage.key)).toBe(false);
    expect(outlineOfDraft(next).kind).toBe("outline");
  });

  test("CR-127 · bật «Bắt đầu bằng phiếu» ⇒ vẫn soạn được theo khối (node phiếu là một bước)", () => {
    const d = sample();
    const r = addStartFormFirst(
      d,
      freshStartStage({ name: "Phiếu yêu cầu", fieldLabel: "Ô 1", flowName: "Đề xuất" }),
    );
    if ("error" in r) throw new Error(r.error);
    const o = outlineOfDraft(r.stages);
    if (isUnsupported(o)) throw new Error(`${o.code}: ${o.reason}`);
    expect(outlineNodes(o)[0]?.stage.key).toBe("phieu");
  });

  test("CR-127 · bước Duyệt đã có Hoàn tất / Từ chối trong nháp ⇒ bật phiếu vẫn soạn được", () => {
    const o0: Outline = { kind: "outline", items: [], exits: [] };
    const n = nodeFromDraft(
      {
        ...emptyStage(),
        name: "Duyệt",
        executor: "approve",
        after: "review",
        approve: { reject: null, ret: null },
      },
      takenKeys(withDefaultEnds(o0)),
    );
    const o = withDefaultEnds({ ...o0, items: [n] });
    const d = draftFromOutline([], o);
    const r = addStartFormFirst(
      d,
      freshStartStage({ name: "Phiếu yêu cầu", fieldLabel: "Ô 1", flowName: "Đề xuất" }),
    );
    if ("error" in r) throw new Error(r.error);
    // đích Từ chối / Trả lại đã dời theo bước mới (trang gọi `setStages(…, false)`: remap lần hai sẽ làm lệch)
    expect(r.stages[1]?.approve).toEqual({ reject: 3, ret: 4 });
    const res = outlineOfDraft(r.stages);
    if (isUnsupported(res)) throw new Error(`${res.code}: ${res.reason}`);
    expect(outlineNodes(res)[0]?.stage.key).toBe("phieu");
  });
});
