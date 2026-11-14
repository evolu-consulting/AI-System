// CR-150 · luật thuần của seed UAT 2 công ty: guard stack, kế hoạch evolu CHỈ THÊM + idempotent, quy trình demo/evolu đúng hình.
import { describe, expect, it } from "bun:test";
import {
  demoFlows,
  EVOLU_GROUPS,
  EVOLU_USERS,
  type EvoluState,
  flowOrder,
  partnerGuard,
  planEvolu,
  receiveFlow,
  withEsign,
} from "./seed-demo-partner.data";

const STG = {
  S2_STACK: "stg-test",
  S2_PUBLIC_ADMIN_URL: "https://ai-test-admin.example.test",
};
const empty: EvoluState = {
  users: new Set(["nguoi-co-san"]),
  groups: new Map([
    ["contracts-owner", new Set(["nguoi-co-san"])],
    ["contracts-editor", new Set(["nguoi-khac"])],
  ]),
};
/** Áp kế hoạch lên trạng thái (như script làm) để thử chạy lần 2. */
function apply(s: EvoluState, plan: ReturnType<typeof planEvolu>): EvoluState {
  const users = new Set(s.users);
  const groups = new Map([...s.groups].map(([k, v]) => [k, new Set(v)]));
  for (const a of plan.actions) {
    if (a.op === "create_user") users.add(a.username);
    if (a.op === "create_group") groups.set(a.key, new Set());
    if (a.op === "add_member") groups.get(a.group)?.add(a.username);
  }
  return { users, groups };
}

describe("CR-150 · partnerGuard", () => {
  it("chỉ cho chạy trên stack stg-test", () => {
    expect(partnerGuard(STG, "postgres://u:p@pg:5432/db")).toBeNull();
    expect(partnerGuard({}, "postgres://u:p@pg:5432/db")).toContain("stg-test");
    expect(partnerGuard({ ...STG, APP_ENV: "production" }, "postgres://u:p@pg:5432/db")).toContain(
      "stg-test",
    );
    expect(partnerGuard({ S2_STACK: "stg-test" }, "postgres://u:p@pg:5432/db")).toContain(
      "stg-test",
    );
  });
  it("DB host lạ bị từ chối dù đúng stack", () => {
    expect(partnerGuard(STG, "postgres://u:p@db.prod.example:5432/db")).not.toBeNull();
  });
});

describe("CR-150 · planEvolu chỉ thêm, idempotent", () => {
  it("lần 1: tạo người + nhóm UAT, thêm vào nhóm gói; lần 2: kế hoạch rỗng", () => {
    const p1 = planEvolu(empty);
    expect(p1.missingPackGroups).toEqual([]);
    expect(p1.actions.filter((a) => a.op === "create_user").length).toBe(EVOLU_USERS.length);
    expect(p1.actions.filter((a) => a.op === "create_group").length).toBe(EVOLU_GROUPS.length);
    const p2 = planEvolu(apply(empty, p1));
    expect(p2.actions).toEqual([]);
  });
  it("không có hành động xoá/sửa và không đụng người/nhóm có sẵn", () => {
    const p = planEvolu(empty);
    for (const a of p.actions)
      expect(["create_user", "create_group", "add_member"]).toContain(a.op);
    const touched = p.actions.map((a) => (a.op === "add_member" ? a.username : ""));
    expect(touched).not.toContain("nguoi-co-san");
    expect(touched).not.toContain("nguoi-khac");
    expect(p.actions.some((a) => a.op === "create_user" && a.username === "nguoi-co-san")).toBe(
      false,
    );
  });
  it("người UAT đã có sẵn ⇒ không tạo lại; thiếu nhóm gói ⇒ báo, không tự tạo", () => {
    const s: EvoluState = {
      users: new Set(EVOLU_USERS.map((u) => u.username)),
      groups: new Map(),
    };
    const p = planEvolu(s);
    expect(p.actions.some((a) => a.op === "create_user")).toBe(false);
    expect(p.missingPackGroups.sort()).toEqual(["contracts-editor", "contracts-owner"]);
    expect(p.actions.some((a) => a.op === "create_group" && a.key.startsWith("contracts-"))).toBe(
      false,
    );
  });
  it("tên đăng nhập UAT có tiền tố uat-nhan- (không trùng người thật)", () => {
    for (const u of EVOLU_USERS) expect(u.username.startsWith("uat-nhan-")).toBe(true);
  });
});

describe("CR-150 · quy trình", () => {
  const steps = (xs: unknown[]) =>
    xs as { step: number; key: string; executor: { kind?: string } }[];
  it("demo: ≥ 2 quy trình có «Bắt đầu khi» khác nhau, bước liên tục, có Ký + gửi đối tác", () => {
    const f = demoFlows();
    expect(f.length).toBeGreaterThanOrEqual(2);
    expect(new Set(f.map((x) => JSON.stringify(x.trigger))).size).toBe(f.length);
    for (const x of f) {
      expect(steps(x.stages).map((s) => s.step)).toEqual(x.stages.map((_, i) => i));
      expect(JSON.stringify(x.stages)).toContain("contracts-esign-send");
    }
    expect(
      f.filter((x) => JSON.stringify(x.stages).includes("contracts-partner-send")).length,
    ).toBe(2);
  });
  it("withEsign điền «Ký qua» + người ký phía công ty cho mọi bước gửi ký", () => {
    const out = withEsign(demoFlows()[0]?.stages ?? [], "gid-1");
    const s = JSON.stringify(out);
    expect(s).toContain('"provider":{"from":"const","value":"upload"}');
    expect(s).toContain("group:gid-1");
  });
  it("evolu: Nhận HĐ có ngưỡng + người phụ trách ở trigger.params, Ký, 3 kết quả", () => {
    const r = receiveFlow("11111111-1111-4111-8111-111111111111");
    expect(r.trigger).toEqual({
      event: "contract.received",
      params: {
        important_min_m: 300,
        critical_min_m: 1000,
        owner_user_id: "11111111-1111-4111-8111-111111111111",
      },
    });
    const s = JSON.stringify(r.stages);
    expect(s).toContain("contracts-esign-send");
    for (const o of ["confirmed", "declined", "returned"]) expect(s).toContain(o);
  });
  it("flowOrder: quy trình UAT lên đầu, phần còn lại giữ thứ tự", () => {
    expect(flowOrder(["x", "a", "y", "b"], ["a", "b"])).toEqual(["a", "b", "x", "y"]);
    expect(flowOrder(["x"], [])).toEqual(["x"]);
  });
});
