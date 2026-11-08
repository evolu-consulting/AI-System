import { describe, expect, test } from "bun:test";
import {
  type AppNodeDecl,
  COMMUNITY_MANIFEST,
  CONTRACTS_MANIFEST,
  CORE_NODES,
} from "@ai/contracts/app-manifest";
import { featureNodeByKey, MODULES as REGISTRY } from "@ai/contracts/modules";
import { eventOf, finishPatch, nodesForApp } from "./flow-def";
import { isOutcomeOnlyNode, splitMenu } from "./node-menu";

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

const table = nodesForApp("contracts");

describe("CR-123 FR-12 · menu + chỉ có bước nghiệp vụ cho công ty", () => {
  test("công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng", () => {
    const m = splitMenu({ app: "contracts", isPlatform: false, table, modules: MODULES });
    expect(ids(m.business)).toEqual([
      "approve",
      "if",
      "contracts.esign",
      "contracts.partner-send",
      "core.bell",
      "core.email",
      "core.subprocess",
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
});

describe("CR-123 FR-12 · menu + chỉ có bước nghiệp vụ cho công ty", () => {
  test("CR-125 c6b · flow community không thấy node hợp đồng, flow hợp đồng không thấy node community", () => {
    // palette trả MỌI node (xấu nhất: Hub quên lọc app) ⇒ menu vẫn lọc theo app từ sổ MODULES
    const everyone = [...CORE_NODES, ...CONTRACTS_MANIFEST.nodes, ...COMMUNITY_MANIFEST.nodes];
    const post = eventOf("community", "post.created");
    const cm = splitMenu({
      app: "community",
      isPlatform: false,
      table: nodesForApp("community"),
      modules: everyone,
      event: post,
    });
    const keys = ids(cm.business);
    expect(keys).toContain("core.bell");
    expect(keys).not.toContain("contracts.esign");
    expect(keys).not.toContain("contracts.partner-send");
    const ct = splitMenu({
      app: "contracts",
      isPlatform: true,
      table: nodesForApp("contracts"),
      modules: everyone,
      event: eventOf("contracts", "contract.submitted"),
    });
    expect([...ids(ct.business), ...ids(ct.advanced)]).not.toContain("community.show-post");
    expect(ids(ct.business)).toContain("contracts.esign");
  });
  test("CR-125 c6b · Hiện bài chỉ có MỘT lối là Kết thúc · Hiện bài, node community.show-post không hiện ở menu nào nhưng vẫn đăng ký", () => {
    for (const isPlatform of [false, true]) {
      const m = splitMenu({
        app: "community",
        isPlatform,
        table: nodesForApp("community"),
        modules: COMMUNITY_MANIFEST.nodes,
        event: eventOf("community", "post.created"),
      });
      const all = [...ids(m.business), ...ids(m.advanced)];
      expect(all).not.toContain("community.show-post");
      const ends = m.business.flatMap((x) =>
        x.kind === "table" && x.entry.outcome?.key === "shown" ? [x.entry.outcome.label] : [],
      );
      expect(ends).toEqual(["Hiện bài"]);
    }
    // flow đã lưu mang khoá node này vẫn mở được: node còn trong sổ MODULES
    expect(featureNodeByKey(REGISTRY, "community.show-post")?.stages[0]?.outcome).toBe("shown");
  });
});

describe("CR-123 FR-12 · menu + chỉ có bước nghiệp vụ cho công ty", () => {
  test("CR-125 c6b · luật chung: node chỉ là một Kết thúc đặt sẵn kết quả thì trùng mục Kết thúc, node nhiều bước thì không", () => {
    const end = { ...mod("x.end"), stages: [{ outcome: "shown" }] } as unknown as AppNodeDecl;
    const two = {
      ...mod("x.two"),
      stages: [{ executor: { kind: "set" } }, { outcome: "shown" }],
    } as unknown as AppNodeDecl;
    expect(isOutcomeOnlyNode(end)).toBe(true);
    expect(isOutcomeOnlyNode(two)).toBe(false);
    expect(isOutcomeOnlyNode(mod("x.plain"))).toBe(false);
  });
  test("CR-125 c6 · B3: Kết thúc tách theo kết quả của sự kiện (community: Hiện bài / Ẩn bài, hợp đồng: Đã duyệt / Từ chối / Trả lại)", () => {
    const ends = (app: string, key: string) =>
      splitMenu({
        app,
        isPlatform: false,
        table: nodesForApp(app),
        modules: [],
        event: eventOf(app, key),
      }).business.flatMap((x) =>
        x.kind === "table" && x.entry.outcome ? [`${x.entry.id}:${x.entry.outcome.label}`] : [],
      );
    expect(ends("community", "post.created")).toEqual(["finish:Hiện bài", "finish:Ẩn bài"]);
    expect(ends("contracts", "contract.submitted")).toEqual([
      "finish:Đã duyệt",
      "finish:Từ chối",
      "finish:Trả lại",
    ]);
  });
  test("CR-125 c6 · B3: Kết thúc chọn từ menu mang đúng kết quả đã chọn", () => {
    const ev = eventOf("community", "post.created");
    expect(finishPatch(ev, "hidden").outcome).toBe("hidden");
    expect(finishPatch(ev).outcome).toBe("shown");
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
