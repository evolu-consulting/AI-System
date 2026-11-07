// CR-123 · u4 · UX canvas: câu lỗi node có bản dịch, cạnh vàng không nhắc thứ trigger đã có, Có/Không chỉ "là / không là",
// bước hành động thật cần người duyệt ngay trước (một nguồn cho picker / kéo thả / lưu), không lộ loại kỹ thuật dưới tên bước.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { APP_MANIFESTS, CONTRACTS_MANIFEST, startOutputsOf } from "@ai/contracts/app-manifest";
import { stageViews } from "../components/canvas/stage-view";
import { opsForType } from "../domain/branch-rules";
import { newRealViolation } from "../domain/tool-rules";
import { emptyStage } from "./def-form";
import { factSources } from "./if-form";
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
