// HUB-FR-78 · CR-054 · chênh lệch grant của ngăn Cấp quyền.
import { describe, expect, test } from "bun:test";
import type { AgentGrantRow } from "@ai/contracts/hub-admin";
import { grantDiff, isEmptyDiff, selectionFromRows, toggleIn } from "./grant-draft";

const T = "e4a0e000-0000-4000-8000-000000000001";
const G = "e4a0e000-0000-4000-8000-000000000002";
const U = "e4a0e000-0000-4000-8000-000000000003";
const U2 = "e4a0e000-0000-4000-8000-000000000004";
const META = { granted_by: null, granted_at: "2026-10-08T00:00:00.000Z" };
const group: AgentGrantRow = {
  id: "e4a0e000-0000-4000-8000-000000000010",
  subject: {
    type: "group",
    group: { id: G, key: "kt", name: { vi: "Kế toán", en: "Acc" }, is_beta: false },
  },
  ...META,
};
const user: AgentGrantRow = {
  id: "e4a0e000-0000-4000-8000-000000000011",
  subject: { type: "user", user: { id: U, username: "vio", display_name: "Vio" } },
  ...META,
};
const tenant: AgentGrantRow = {
  id: "e4a0e000-0000-4000-8000-000000000012",
  subject: { type: "tenant" },
  ...META,
};

describe("grant-draft", () => {
  test("lựa chọn ban đầu từ grant", () => {
    const s = selectionFromRows([group, user]);
    expect(s.scope).toBe("some");
    expect([...s.groups]).toEqual([G]);
    expect([...s.users]).toEqual([U]);
    expect(selectionFromRows([tenant, group]).scope).toBe("all");
  });

  test("không đổi ⇒ diff rỗng", () => {
    expect(isEmptyDiff(grantDiff([group, user], selectionFromRows([group, user]), T))).toBe(true);
  });

  test("chuyển sang Cả công ty ⇒ thêm tenant, thu hồi nhóm/người", () => {
    const d = grantDiff(
      [group, user],
      { scope: "all", groups: new Set([G]), users: new Set([U]) },
      T,
    );
    expect(d.add).toEqual([{ subject_type: "tenant", subject_id: T }]);
    expect(d.remove).toEqual([
      { subject_type: "group", subject_id: G },
      { subject_type: "user", subject_id: U },
    ]);
  });

  test("từ Cả công ty về chọn người ⇒ thêm người, thu hồi tenant", () => {
    const d = grantDiff([tenant], { scope: "some", groups: new Set(), users: new Set([U2]) }, T);
    expect(d.add).toEqual([{ subject_type: "user", subject_id: U2 }]);
    expect(d.remove).toEqual([{ subject_type: "tenant", subject_id: T }]);
  });

  test("toggleIn không đổi tập cũ", () => {
    const a = new Set([G]);
    const b = toggleIn(a, U, true);
    expect([...a]).toEqual([G]);
    expect([...b]).toEqual([G, U]);
    expect([...toggleIn(b, G, false)]).toEqual([U]);
  });
});
