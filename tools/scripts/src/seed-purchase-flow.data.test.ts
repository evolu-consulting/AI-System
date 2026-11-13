// CR-140 · dữ liệu «Quy trình mua hàng» (1 cha + 3 con): số bước, mã nhóm hợp lệ (phòng ban demo.yaml + nhóm vai), nối bước đúng.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseSpec } from "../../../apps/admin-api/src/modules/tenant-onboard/adapters/onboard.schema";
import { ROLE_GROUPS } from "./seed-demo-org.data";
import {
  A_INPUTS,
  B_INPUTS,
  C_INPUTS,
  groupKeysOf,
  PARENT_FORM,
  PURCHASE_FLOWS,
  stagesA,
  stagesB,
  stagesC,
  stagesParent,
} from "./seed-purchase-flow.data";
import { G } from "./seed-purchase-flow.kit";

type St = {
  key: string;
  step: number;
  node?: string;
  outcome?: string;
  next_step?: number;
  executor: Record<string, unknown> & { kind: string };
  after: Record<string, unknown>;
};
const spec = (() => {
  const r = parseSpec(readFileSync("deploy/tenants/demo.yaml", "utf8"));
  if (!r.ok) throw new Error("demo.yaml không hợp lệ");
  return r.spec;
})();
const validKeys = new Set([
  spec.root.key,
  ...spec.departments.map((d) => d.key),
  ...ROLE_GROUPS.map((g) => g.key),
]);
const A = stagesA() as St[];
const B = stagesB() as St[];
const C = stagesC() as St[];
const P = stagesParent({ a: "mh-a", b: "mh-b", c: "mh-c" }) as St[];
const all = [A, B, C, P];

describe("demo:purchase · định nghĩa quy trình mua hàng", () => {
  it("mỗi con có đủ bước theo bảng 11 dòng (A 1–5, B 6–7, C 8–11)", () => {
    const work = (xs: St[]) => xs.filter((s) => s.executor.kind === "form").length;
    const appr = (xs: St[]) => xs.filter((s) => s.executor.kind === "approve").length;
    expect([work(A), work(B), work(C)]).toEqual([4, 1, 4]); // báo giá · so sánh · ngân sách · PO | soạn HĐ | 8 · 9 · 10 · 11
    expect([appr(A), appr(B), appr(C)]).toEqual([6, 2, 4]);
    expect(PURCHASE_FLOWS.map((f) => f.inputs.length)).toEqual([
      A_INPUTS.length,
      B_INPUTS.length,
      C_INPUTS.length,
    ]);
  });
  it("mã nhóm chỉ lấy từ phòng ban của demo.yaml + nhóm vai (không nhóm trùng phòng ban)", () => {
    for (const xs of all)
      for (const k of groupKeysOf(xs)) expect(validKeys.has(k), `nhóm «${k}»`).toBe(true);
    expect(groupKeysOf(A)).toContain("tai-chinh");
    expect(groupKeysOf(C)).toEqual(
      expect.arrayContaining(["ke-toan-thanh-toan", "thu-quy", "pb-kho-van", "pb-ke-toan"]),
    );
  });
  it("«Trưởng phòng đề xuất duyệt» đi theo người đề xuất; Giám đốc chỉ > 500 triệu", () => {
    expect(A[0]?.after.approver_mode).toBe("starter_head");
    const iff = A.find((s) => s.executor.kind === "if") as St;
    expect(JSON.stringify(iff.executor.when)).toContain("500000000");
    expect(iff.executor.then_step).toBe(7);
    expect(A[7]?.next_step).toBe(9); // GĐ duyệt xong bỏ qua nhánh TP Mua hàng
  });
  it("duyệt song song «tất cả» cho 3 điểm cần nhiều bên (A·B·C)", () => {
    const par = [...A, ...B, ...C].filter((s) => s.after.parallel);
    expect(par.length).toBe(3);
    for (const s of par) expect((s.after.parallel as { rule: string }).rule).toBe("all");
  });
  it("CR-140 · nhánh song song Mua hàng / Kế toán / Giám đốc chỉ trưởng phòng duyệt (`head_only`)", () => {
    type Br = { group_key: string; head_only?: boolean };
    const brs = [...A, ...B, ...C].flatMap(
      (s) => (s.after.parallel as { groups: Br[] } | undefined)?.groups ?? [],
    );
    const heads = new Set<string>([G.muaHang, G.keToan, G.giamDoc]);
    for (const b of brs) expect(b.head_only === true).toBe(heads.has(b.group_key));
  });
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một vòng kiểm đích rẽ
  it("nối bước: mọi đích rẽ trỏ vào bước có thật; bước cuối là Kết thúc", () => {
    for (const xs of all) {
      const steps = new Set(xs.map((s) => s.step));
      for (const s of xs) {
        const e = s.executor as Record<string, number | null | { goto_step: number }[]>;
        for (const k of ["then_step", "else_step", "reject_step", "return_step"])
          if (typeof e[k] === "number") expect(steps.has(e[k] as number)).toBe(true);
        for (const b of (e.branches as { goto_step: number }[] | undefined) ?? [])
          expect(steps.has(b.goto_step)).toBe(true);
      }
      expect(xs.filter((s) => s.outcome).length).toBeGreaterThanOrEqual(2);
    }
  });
  it("cha: phiếu → A → Nếu ≥ 20 triệu (B, không thì bỏ) → C → Đã xong / Không mua", () => {
    expect(P.map((s) => s.key)).toEqual([
      "phieu-mua-hang",
      "phan-1",
      "re-hop-dong",
      "phan-2",
      "phan-3",
      "da-xong",
      "khong-mua",
    ]);
    expect(P[0]?.node).toBe("core.start-form");
    expect(PARENT_FORM.fields.map((f) => f.key)).toContain("du_toan");
    const iff = P[2] as St;
    expect([iff.executor.then_step, iff.executor.else_step]).toEqual([3, 4]);
    expect(JSON.stringify(iff.executor.when)).toContain("20000000");
    expect(
      P.slice(1, 5)
        .filter((s) => s.node === "core.subprocess")
        .map((s) => s.executor.def_key),
    ).toEqual(["mh-a", "mh-b", "mh-c"]);
  });
  it("HĐ: tệp lấy từ bước Pháp chế soạn của chính lượt B (tệp lượt con khác không đi sang)", () => {
    const create = B.find((s) => s.node === "contracts.create-from-step") as St;
    const args = create.executor.args as Record<string, { from: string; stage_key?: string }>;
    expect(args.file_id?.stage_key).toBe("6-soan-hd");
    expect(args.amount?.from).toBe("input");
  });
  it("CR-140 · bước 11: sau «Đã chi» ghi khoản đã chi vào sổ thanh toán của HĐ (số tiền bước 10, ngày chi bước 11)", () => {
    const i = C.findIndex((s) => s.key === "11-thanh-toan");
    const rec = C[i + 1] as St;
    expect(rec.node).toBe("contracts.record-payment");
    expect(rec.step).toBe((C[i] as St).step + 1);
    expect(rec.executor.tool_key).toBe("contracts-record-payment");
    const args = rec.executor.args as Record<
      string,
      { from: string; stage_key?: string; field?: string }
    >;
    expect(args.contract_id).toBeUndefined();
    expect(args.amount).toMatchObject({ stage_key: "10-de-nghi-tt", field: "so_tien_tt" });
    expect(args.paid_at).toMatchObject({ stage_key: "11-thanh-toan", field: "ngay_chi" });
  });
});
