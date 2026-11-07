import { describe, expect, test } from "bun:test";
import { type AppNodeDecl, CONTRACTS_MANIFEST, CORE_NODES } from "@ai/contracts/app-manifest";
import { nodesForApp } from "./flow-def";
import { splitMenu } from "./node-menu";

const mod = (key: string, menu?: AppNodeDecl["menu"]): AppNodeDecl =>
  ({
    key,
    label: { vi: key, en: key },
    ...(menu ? { menu } : {}),
    stages: [],
    inputs: [],
    outputs: [],
  }) as unknown as AppNodeDecl;
// Node thật (menu khai ở `MODULES`) + hai node nâng cao giả lập (Dify, DLC không khai menu).
const real = [...CORE_NODES, ...CONTRACTS_MANIFEST.nodes];
const MODULES = [...real, mod("dify.run"), mod("dlc.step")];
const ids = (xs: ReturnType<typeof splitMenu>["business"]) =>
  xs.map((x) => (x.kind === "table" ? x.entry.id : x.node.key));

describe("CR-123 FR-12 · menu + chỉ có bước nghiệp vụ cho công ty", () => {
  const table = nodesForApp("contracts");
  test("công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng", () => {
    const m = splitMenu({ app: "contracts", isPlatform: false, table, modules: MODULES });
    expect(ids(m.business)).toEqual([
      "approve",
      "if",
      "contracts.esign",
      "core.bell",
      "core.email",
      "finish",
    ]);
    expect(m.advanced).toEqual([]);
  });
  test("quản trị nền tảng: cùng nhóm nghiệp vụ + Nâng cao (Agent, Công cụ, Dify, DLC, Hẹn giờ; Ghi giá trị cuối)", () => {
    const m = splitMenu({ app: "contracts", isPlatform: true, table, modules: MODULES });
    expect(ids(m.business)).toContain("contracts.esign");
    const adv = ids(m.advanced);
    for (const k of ["form", "agent", "tool", "dify.run", "dlc.step", "core.wait-until"])
      expect(adv).toContain(k);
    expect(adv.at(-1)).toBe("set");
    expect(adv).not.toContain("approve");
  });
  test("không app nào có mục 'Chờ ký xong' riêng (kể cả nâng cao)", () => {
    for (const app of ["contracts", "community"]) {
      const m = splitMenu({
        app,
        isPlatform: true,
        table: nodesForApp(app),
        modules: MODULES,
      });
      expect([...ids(m.business), ...ids(m.advanced)]).not.toContain("waitEsign");
    }
  });
});
