// PK-FR-05 · PK-AC05 · PK-AC06 · N1 plan §5 · `packActionsFor` (luật `checkPackAccess` có test khoá của qc ở tests/acceptance/N1).
import { describe, expect, test } from "bun:test";
import { checkPackAccess, type PackActionsInput, packActionsFor } from "./pack-access.rules";

const OWN = "g-owner";
const EDI = "g-editor";
const VIE = "g-viewer";
const grantedByAction = { read: [OWN, EDI, VIE], write: [OWN, EDI], admin: [OWN] };
const inp = (groups: string[], o: Partial<PackActionsInput> = {}): PackActionsInput => ({
  entitled: true,
  featureOff: false,
  userGroupIds: new Set(groups),
  grantedByAction,
  ...o,
});

describe("packActionsFor", () => {
  test("PK-AC05 · viewer=[read] · editor=[read,write] · owner=[read,write,admin] · không Group=[]", () => {
    expect(packActionsFor(inp([VIE]))).toEqual(["read"]);
    expect(packActionsFor(inp([EDI]))).toEqual(["read", "write"]);
    expect(packActionsFor(inp([OWN]))).toEqual(["read", "write", "admin"]);
    expect(packActionsFor(inp([]))).toEqual([]);
  });
  test("PK-AC05 · hợp các Group, thứ tự theo PACK_ACTIONS", () => {
    expect(packActionsFor(inp([OWN, VIE]))).toEqual(["read", "write", "admin"]);
  });
  test("PK-AC06 · chưa bật hoặc feature off ⇒ [] dù có Group", () => {
    expect(packActionsFor(inp([OWN], { entitled: false }))).toEqual([]);
    expect(packActionsFor(inp([OWN], { featureOff: true }))).toEqual([]);
  });
  test("PK-FR-05 · nhất quán với checkPackAccess cho từng việc", () => {
    for (const g of [[VIE], [EDI], [OWN], []]) {
      const i = inp(g);
      const viaCheck = (["read", "write", "admin"] as const).filter(
        (a) => checkPackAccess({ ...i, grantedGroupIds: grantedByAction[a] }) === "ok",
      );
      expect(packActionsFor(i)).toEqual(viaCheck);
    }
  });
});
