// ADM-FR-35 · M3-R08, R09 · ma trận: ô tick theo trạng thái hàng, nháp chênh lệch, tick hàng/cột (tri-state), batch ≤ 200.
import { describe, expect, test } from "bun:test";
import type { MatrixFeature, MatrixGroup } from "@ai/contracts";
import {
  cellChecked,
  cellKey,
  colState,
  countChanges,
  draftToBatch,
  EMPTY_DRAFT,
  lineState,
  type MatrixModel,
  overBatchLimit,
  rowState,
  toggleCell,
  toggleCol,
  toggleRow,
} from "./matrix";

const grp = (id: string) =>
  ({ id, key: id, name: { vi: id }, is_beta: false, member_count: 0 }) as MatrixGroup;
const feat = (id: string, state: string): MatrixFeature =>
  ({
    feature: { id, key: id },
    state,
    command_names: [],
    command_count: 0,
    granted_group_ids: [],
  }) as unknown as MatrixFeature;

const g = [grp("g1"), grp("g2"), grp("g3")];
const f = {
  core: feat("core", "core"),
  kt: feat("kt", "entitled"),
  dich: feat("dich", "entitled"),
  rev: feat("rev", "revoked"),
  none: feat("none", "none"),
};
const model: MatrixModel = {
  groups: g,
  features: Object.values(f),
  granted: new Set([cellKey("kt", "g1"), cellKey("rev", "g1")]),
};

describe("ADM-FR-35 · ô tick theo trạng thái hàng", () => {
  test("core luôn tick, none luôn trống, revoked giữ theo grant, entitled theo nháp", () => {
    expect(cellChecked(model, EMPTY_DRAFT, f.core, g[0] as MatrixGroup)).toBe(true);
    expect(cellChecked(model, EMPTY_DRAFT, f.none, g[0] as MatrixGroup)).toBe(false);
    expect(cellChecked(model, EMPTY_DRAFT, f.rev, g[0] as MatrixGroup)).toBe(true);
    expect(cellChecked(model, EMPTY_DRAFT, f.kt, g[0] as MatrixGroup)).toBe(true);
    expect(cellChecked(model, EMPTY_DRAFT, f.kt, g[1] as MatrixGroup)).toBe(false);
  });

  test("toggleCell: bật rồi tắt lại cùng ô → xoá khỏi nháp; ô khoá không đổi", () => {
    const on = toggleCell(model, EMPTY_DRAFT, f.dich, g[0] as MatrixGroup);
    expect(on.get(cellKey("dich", "g1"))).toBe(true);
    expect(toggleCell(model, on, f.dich, g[0] as MatrixGroup).size).toBe(0);
    expect(toggleCell(model, EMPTY_DRAFT, f.core, g[0] as MatrixGroup).size).toBe(0);
    expect(toggleCell(model, EMPTY_DRAFT, f.rev, g[0] as MatrixGroup).size).toBe(0);
    expect(toggleCell(model, EMPTY_DRAFT, f.none, g[0] as MatrixGroup).size).toBe(0);
  });
});

describe("ADM-FR-35 · tick hàng/cột (tri-state) và batch", () => {
  test("rowState/toggleRow: chưa đủ → bật hết, đủ → tắt hết; hàng khoá bỏ qua", () => {
    expect(rowState(model, EMPTY_DRAFT, f.kt)).toBe("mixed");
    const all = toggleRow(model, EMPTY_DRAFT, f.kt);
    expect(rowState(model, all, f.kt)).toBe("checked");
    expect(rowState(model, toggleRow(model, all, f.kt), f.kt)).toBe("unchecked");
    expect(toggleRow(model, EMPTY_DRAFT, f.core).size).toBe(0);
  });

  test("toggleCol chỉ tác động hàng sửa được (bỏ core, revoked, none)", () => {
    const col = toggleCol(model, EMPTY_DRAFT, g[1] as MatrixGroup);
    expect([...col.keys()].sort()).toEqual([cellKey("dich", "g2"), cellKey("kt", "g2")]);
    expect(colState(model, col, g[1] as MatrixGroup)).toBe("checked");
  });

  test("draftToBatch: cấp/thu đúng, bỏ mục không còn hợp lệ; countChanges", () => {
    const d = new Map([
      [cellKey("dich", "g1"), true],
      [cellKey("kt", "g1"), false],
      [cellKey("rev", "g2"), true],
      [cellKey("kt", "zz"), true],
      [cellKey("kt", "g2"), false],
    ]);
    const b = draftToBatch(model, d);
    expect(b.add).toEqual([{ feature_id: "dich", group_id: "g1" }]);
    expect(b.remove).toEqual([{ feature_id: "kt", group_id: "g1" }]);
    expect(countChanges(model, d)).toBe(2);
  });

  test("lineState và giới hạn batch 200", () => {
    expect(lineState(0, 3)).toBe("unchecked");
    expect(lineState(3, 3)).toBe("checked");
    expect(lineState(1, 3)).toBe("mixed");
    expect(lineState(0, 0)).toBe("unchecked");
    expect(overBatchLimit(200)).toBe(false);
    expect(overBatchLimit(201)).toBe(true);
  });
});
