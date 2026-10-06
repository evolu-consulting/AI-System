// X1-AC10 · ADM-FR-10 · `side_effect` ở contract workflows/transfer + Import/Export + audit (plan §2.1). Dùng fixture
// luật M4 (`_transfer-data.ts`, chỉ đọc). Đỏ ở expect (contract chưa có trường) tới khi B1 xong.
import { describe, expect, it } from "bun:test";
import {
  WorkflowCreateRequestSchema,
  WorkflowElSchema,
  WorkflowListItemSchema,
  WorkflowSchema,
  WorkflowUpdateRequestSchema,
} from "@ai/contracts";
import { loadTransferRules } from "../../M4/_cd-modules";
import { fileOf, ruleSnapshot, TYPES, workflowEl } from "../../M4/_transfer-data";
import { type Loose, loadAuditFields } from "../_modules";

const NOW = new Date("2026-10-07T08:00:00.000Z");
const shapeOf = (s: unknown): Loose => (s as { shape: Loose }).shape;

/** Snapshot M4 có cột mới: translate bật cờ, còn lại false. */
function snapWith(): Loose {
  const s = ruleSnapshot();
  s.workflows = s.workflows.map((w: Loose) => ({ ...w, side_effect: w.key === "translate" }));
  return s;
}

describe("X1-AC10 · contract workflows (BL4)", () => {
  it("X1-AC10 · WorkflowSchema/WorkflowListItemSchema có side_effect boolean bắt buộc", () => {
    for (const S of [WorkflowSchema, WorkflowListItemSchema]) {
      const f = shapeOf(S).side_effect;
      expect(f).toBeDefined();
      expect(f.safeParse(true).success).toBe(true);
      expect(f.safeParse(undefined).success).toBe(false);
    }
  });

  it("X1-AC10 · Create/Update: side_effect tuỳ chọn, không .default (vắng ⇒ undefined)", () => {
    for (const S of [WorkflowCreateRequestSchema, WorkflowUpdateRequestSchema]) {
      const f = shapeOf(S).side_effect;
      expect(f).toBeDefined();
      expect(f.safeParse(true).success).toBe(true);
      expect(f.safeParse(undefined).success).toBe(true);
      expect(f.safeParse(undefined).data).toBeUndefined();
      expect(f.safeParse("yes").success).toBe(false);
    }
  });

  it("X1-AC10 · WorkflowElSchema: file v1 không có side_effect vẫn hợp lệ; có side_effect boolean hợp lệ", () => {
    const el = workflowEl("translate");
    expect(WorkflowElSchema.safeParse(el).success).toBe(true);
    expect(WorkflowElSchema.safeParse({ ...el, side_effect: true }).success).toBe(true);
    expect(WorkflowElSchema.safeParse({ ...el, side_effect: "true" }).success).toBe(false);
  });
});

describe("X1-AC10 · Import/Export (transfer.rules)", () => {
  it("X1-AC10 · export luôn ghi side_effect cho mọi workflow", async () => {
    const r = await loadTransferRules();
    const f = r.buildExportFile(snapWith(), TYPES, NOW);
    const byKey = Object.fromEntries(f.workflows.map((w: Loose) => [w.key, w]));
    expect(byKey.translate.side_effect).toBe(true);
    for (const w of f.workflows) expect(typeof w.side_effect).toBe("boolean");
  });

  it("X1-AC10 · import cập nhật, file vắng side_effect ⇒ không diff (không âm thầm tắt cờ)", async () => {
    const r = await loadTransferRules();
    const s = snapWith();
    const file = fileOf(s);
    file.workflows = file.workflows.map(({ side_effect: _x, ...w }: Loose) => w);
    const p = await r.planImport(file, s);
    expect(p.errors).toEqual([]);
    expect(p.items.filter((i: Loose) => i.type === "workflow")).toEqual([]);
  });

  it("X1-AC10 · import có side_effect khác ⇒ 1 item update workflow translate; giống ⇒ không item", async () => {
    const r = await loadTransferRules();
    const s = snapWith();
    const same = await r.planImport(fileOf(s), s);
    expect(same.items).toEqual([]);
    const file = fileOf(s);
    file.workflows = file.workflows.map((w: Loose) =>
      w.key === "translate" ? { ...w, side_effect: false } : w,
    );
    const p = await r.planImport(file, s);
    const wf = p.items.filter((i: Loose) => i.type === "workflow");
    expect(wf).toHaveLength(1);
    expect(wf[0]).toMatchObject({ key: "translate", op: "update" });
    expect(wf[0].after.side_effect).toBe(false);
  });
});

describe("X1-AC10 · audit (plan §2.1)", () => {
  it("X1-AC10 · AUDIT_FIELDS.workflow có side_effect; auditSnapshot giữ side_effect", async () => {
    const a = await loadAuditFields();
    expect(a.AUDIT_FIELDS.workflow).toContain("side_effect");
    const out = a.auditSnapshot("workflow", { key: "translate", side_effect: true, id: "x" });
    expect(out.side_effect).toBe(true);
  });
});
