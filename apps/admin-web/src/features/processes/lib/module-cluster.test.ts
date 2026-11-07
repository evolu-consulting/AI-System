// CR-123 · u3a · FR-14 · chèn / xoá / sao chép node Ký số đi cả cụm; mặc định nhánh của stage chờ.
import { describe, expect, test } from "bun:test";
import { getAppManifest } from "@ai/contracts/app-manifest";
import type { StageDraft } from "./draft-types";
import {
  clusterIndexes,
  duplicateCluster,
  expandToClusters,
  moduleClusters,
  removeCluster,
  waitBranchDefaults,
} from "./module-cluster";
import { nodeToPatches } from "./palette-node";
import { emptyStage } from "./stage-convert";

const ESIGN = getAppManifest("contracts")?.nodes.find((n) => n.key === "contracts.esign");
if (!ESIGN) throw new Error("manifest thiếu contracts.esign");

const mk = (key: string, step: number, patch: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  key,
  name: key,
  ...patch,
});
/** Cụm Ký số dựng từ chính manifest (như menu "+"): hai stage, mỗi stage một bước. */
const esign = (step: number): StageDraft[] =>
  nodeToPatches(ESIGN).map((p, k) => mk(`ky${step + k}`, step + k, p));
const finish = (step: number, outcome: string) => mk(`end-${outcome}`, step, { outcome });

describe("chèn Ký số = cả cụm", () => {
  test("nodeToPatches cho 2 stage cùng node, tool rồi wait_event, chờ 168 giờ", () => {
    const [a, b] = esign(0);
    expect([a?.node, b?.node]).toEqual(["contracts.esign", "contracts.esign"]);
    expect([a?.executor, b?.executor]).toEqual(["tool", "wait_event"]);
    expect(b?.wait.timeoutH).toBe("168");
    expect(moduleClusters([a, b] as StageDraft[]).length).toBe(1);
  });
});

describe("xoá / sao chép cả cụm", () => {
  const st = [mk("a", 0), ...esign(1), finish(3, "rejected"), finish(4, "approved")];
  test("clusterIndexes + expandToClusters", () => {
    expect(clusterIndexes(st, 2)).toEqual([1, 2]);
    expect(clusterIndexes(st, 0)).toEqual([0]);
    expect(expandToClusters(st, [st[2]?.uid as string]).sort()).toEqual(
      [st[1]?.uid, st[2]?.uid].sort() as string[],
    );
  });
  test("xoá một stage của cụm ⇒ mất cả hai, bước nén lại", () => {
    const out = removeCluster(st, 2);
    expect(out.map((s) => s.key)).toEqual(["a", "end-rejected", "end-approved"]);
    expect(out.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(removeCluster(st, 0).map((s) => s.key)).toContain("ky1"); // stage thường: như cũ
  });
  test("cụm là toàn bộ flow ⇒ không xoá (luôn còn ≥ 1 stage)", () => {
    const only = esign(0);
    expect(removeCluster(only, 0)).toHaveLength(2);
  });
  test("sao chép ⇒ cả hai stage, nối tiếp ngay sau cụm gốc, mã/uid mới, vẫn là hai cụm hợp lệ", () => {
    const r = duplicateCluster(st, 1);
    if (!("stages" in r)) throw new Error("duplicate lỗi");
    expect(r.stages).toHaveLength(st.length + 2);
    expect(r.stages.map((s) => s.node ?? "-").slice(0, 5)).toEqual([
      "-",
      "contracts.esign",
      "contracts.esign",
      "contracts.esign",
      "contracts.esign",
    ]);
    expect(moduleClusters(r.stages)).toHaveLength(2);
    expect(new Set(r.stages.map((s) => s.uid)).size).toBe(r.stages.length);
    expect(new Set(r.stages.map((s) => s.key)).size).toBe(r.stages.length);
    expect(r.uids).toHaveLength(2);
  });
});

describe("waitBranchDefaults", () => {
  test("có Kết thúc · Từ chối ⇒ declined/voided/timeout đều về bước đó", () => {
    const st = [...esign(0), finish(2, "rejected")];
    const wait = st[1] as StageDraft;
    const p = waitBranchDefaults(st, wait.uid);
    expect(p?.wait?.branches).toEqual([
      { on: "esign.declined", step: 2 },
      { on: "esign.voided", step: 2 },
      { on: "timeout", step: 2 },
    ]);
  });
  test("chưa có Từ chối, hoặc đã có nhánh, hoặc không thuộc cụm ⇒ không đổi", () => {
    const noEnd = esign(0);
    expect(waitBranchDefaults(noEnd, (noEnd[1] as StageDraft).uid)).toBeNull();
    const st = [...esign(0), finish(2, "rejected")];
    const has = { ...(st[1] as StageDraft), wait: { ...(st[1] as StageDraft).wait, branches: [] } };
    expect(waitBranchDefaults([st[0], has, st[2]] as StageDraft[], has.uid)).not.toBeNull();
    const alone = [mk("w", 0, { executor: "wait_event" }), finish(1, "rejected")];
    expect(waitBranchDefaults(alone, (alone[0] as StageDraft).uid)).toBeNull();
  });
});
