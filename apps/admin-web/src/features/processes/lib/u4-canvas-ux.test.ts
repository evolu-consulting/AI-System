// CR-123 · u4 · UX canvas: câu lỗi node có bản dịch, cạnh vàng không nhắc thứ trigger đã có, Có/Không chỉ "là / không là",
// bước hành động thật cần người duyệt ngay trước (một nguồn cho picker / kéo thả / lưu), không lộ loại kỹ thuật dưới tên bước.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_MANIFESTS, CONTRACTS_MANIFEST, startOutputsOf } from "@ai/contracts/app-manifest";
import { newRealViolation } from "@ai/contracts/hub-admin";
import { stageViews } from "../components/canvas/stage-view";
import { opsForType } from "../domain/branch-rules";
import { emptyStage } from "./def-form";
import { whenSummary } from "./fact-when";
import { factSources } from "./if-form";
import { ifSentence } from "./if-sentence";
import { edgeProblems } from "./palette-node";

const load = (l: string) =>
  JSON.parse(
    readFileSync(
      `${import.meta.dir}/../../../../../../packages/i18n/locales/process/admin.${l}.json`,
      "utf8",
    ),
  );
const has = (o: unknown, path: string): boolean => {
  const v = path
    .split(".")
    .reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], {
      process: { ...{ admin: o } },
    });
  return typeof v === "string" && v.trim() !== "";
};

describe("u4 · câu lỗi trên node có bản dịch (vi + en)", () => {
  const keys = [
    "process.admin.flow.toolOff",
    "process.admin.canvas.node.error",
    "process.admin.editor.stage.tool.err.ref",
    "process.admin.canvas.err.realNeedsReview",
    "process.admin.editor.stage.if.opIs",
    "process.admin.editor.stage.if.opIsNot",
  ];
  for (const l of ["vi", "en"])
    test.each(keys)(`${l} · %s`, (k) => {
      expect(has(load(l), k)).toBe(true);
    });
});

const st = (uid: string, step: number, o: Record<string, unknown> = {}) => ({
  ...emptyStage(step),
  uid,
  ...o,
});
const esign = CONTRACTS_MANIFEST.nodes.filter((n) => n.key === "contracts.esign");
const event = APP_MANIFESTS.contracts?.events.find((e) => e.key === "contract.submitted");

describe("u4 · cạnh vàng không nhắc thứ Bắt đầu khi đã có", () => {
  const flow = [
    st("duyet", 0, { after: "review" }),
    st("ky", 1, { node: "contracts.esign" }),
    st("cho", 2, { node: "contracts.esign" }),
  ];
  test("không truyền đầu ra trigger ⇒ báo thiếu Hợp đồng (hành vi cũ)", () => {
    expect(edgeProblems(flow, esign).map((p) => p.key)).toContain("contract_id");
  });
  test("có đầu ra trigger (HĐ) ⇒ không báo", () => {
    expect(event).toBeDefined();
    expect(edgeProblems(flow, esign, startOutputsOf(event))).toEqual([]);
  });
});

describe("u4 · Có/Không", () => {
  test("opsForType boolean chỉ eq / ne, kiểu số vẫn đủ 6", () => {
    expect(opsForType("boolean")).toEqual(["eq", "ne"]);
    expect(opsForType("number")).toHaveLength(6);
  });
  test("dữ kiện boolean thành nguồn kiểu boolean, kiểu lạ vẫn là chuỗi", () => {
    const s = factSources([
      { key: "new_partner", label: "Đối tác mới", type: "boolean" },
      { key: "dept", label: "Phòng", type: "department" },
    ]);
    expect(s.map((x) => x.type)).toEqual(["boolean", "string"]);
  });
});

describe("u4 · newRealViolation (Ký số cần bước duyệt ngay trước)", () => {
  const a = { uid: "a", step: 0, after: "review", real: false };
  test("sau bước duyệt ⇒ hợp lệ", () => {
    expect(newRealViolation([a], [a, { uid: "k", step: 1, after: "auto", real: true }])).toBeNull();
  });
  test("sau bước tự động ⇒ trả uid của bước hành động thật", () => {
    const auto = { uid: "b", step: 0, after: "auto", real: false };
    expect(newRealViolation([auto], [auto, { uid: "k", step: 1, after: "auto", real: true }])).toBe(
      "k",
    );
  });
  test("bước đã sai từ trước không chặn phép khác", () => {
    const bad = [
      { uid: "b", step: 0, after: "auto", real: false },
      { uid: "k", step: 1, after: "auto", real: true },
    ];
    expect(
      newRealViolation(bad, [...bad, { uid: "z", step: 2, after: "auto", real: false }]),
    ).toBeNull();
  });
});

test("u4 · bước Ghi giá trị / Điền thông tin không lộ chữ kỹ thuật dưới tên bước", () => {
  const v = stageViews(
    [st("s", 0, { executor: "set" }), st("f", 1, { executor: "form" })],
    {},
    { agents: [], teams: [], tools: [] },
  );
  expect(v.map((x) => x.executor)).toEqual(["", ""]);
});

describe("u4 · câu Có/Không đọc như người nói", () => {
  const words = {
    if: "Nếu",
    and: "và",
    or: "hoặc",
    goTo: "đi tới",
    otherwise: "ngược lại",
    nextStep: "Bước tiếp theo",
    blank: "…",
    million: "triệu",
    billion: "tỷ",
    ops: { eq: "bằng" },
    bool: { is: "là", isNot: "không là", yes: "Có", no: "Không" },
  };
  test("node Nếu: 'Đối tác mới là Có', không phải 'bằng true'", () => {
    const s = ifSentence({
      join: "and",
      conds: [{ from: "f", op: "eq", value: "true", type: "string", bool: true }],
      fromLabel: () => "Đối tác mới",
      yes: "Bước 2",
      no: null,
      words,
    });
    expect(s).toContain("Đối tác mới là Có");
    expect(s).not.toContain("true");
  });
  test("Bắt đầu khi: dữ kiện boolean đọc 'là Có' / 'không là Không'", () => {
    const facts = [{ key: "np", label: "Đối tác mới", type: "boolean" }] as never;
    const w = (op: string, value: unknown) =>
      ({ op: "and", conds: [{ fact: "np", op, value }] }) as never;
    const j = { and: "và", or: "hoặc" };
    expect(whenSummary(w("eq", true), facts, () => "=", j, words.bool)).toBe("Đối tác mới là Có");
    expect(whenSummary(w("ne", false), facts, () => "=", j, words.bool)).toBe(
      "Đối tác mới không là Không",
    );
  });
});

describe("u4 · MỘT luật Ký số cần bước duyệt ngay trước — mọi đường gọi luật chung của contracts", () => {
  const read = (p: string) => readFileSync(`${import.meta.dir}/../../../../../../${p}`, "utf8");
  const app = "apps/admin-web/src/features/processes";
  test("lưu (Hub REAL_ACTION) và công tắc trình sửa dùng realActionAllowed của contracts", () => {
    expect(read("packages/contracts/src/hub-admin/process-steps.ts")).toContain(
      "realActionAllowed(shape, i)",
    );
    for (const f of ["lib/def-form.ts", "lib/d2-validate.ts"])
      expect(read(`${app}/${f}`)).toMatch(/realActionAllowed[^;]*from "@ai\/contracts\/hub-admin"/);
    expect(read(`${app}/domain/tool-rules.ts`)).not.toContain("realActionAllowed");
  });
  test("picker (chèn trên cạnh / thêm / dời / tách) đi qua use-draft: applySteps + insertOnEdge", () => {
    const d = read(`${app}/hooks/use-draft.ts`);
    expect(d.match(/newRealViolation\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(d).toContain('newRealViolation } from "@ai/contracts/hub-admin"');
  });
  test("kéo thả: thả, kéo nhóm, dán và nối lại đều kiểm luật", () => {
    const e = read(`${app}/hooks/use-canvas-edit.ts`);
    expect(e.match(/newRealViolation\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
