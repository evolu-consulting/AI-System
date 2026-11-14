// CR-150b · kế hoạch sơ đồ tổ chức evolu: chỉ thêm, idempotent, cây + vai quy trình đúng người.
import { describe, expect, it } from "bun:test";
import { RECEIVE, receiveFlow } from "./seed-demo-partner.data";
import {
  ORG_DEPTS,
  ORG_PEOPLE,
  ORG_RECEIVE,
  ORG_ROOT,
  type OrgAction,
  type OrgState,
  planOrg,
} from "./seed-demo-partner.org";

const base = (): OrgState => ({
  users: new Set(["nguoi-co-san"]),
  groups: new Map([
    ["contracts-owner", new Set(["nguoi-co-san"])],
    ["contracts-editor", new Set<string>()],
    ["uat-nhan-ky", new Set(["uat-nhan-ky"])],
  ]),
  depts: new Map(),
  managers: new Map(),
  titles: new Map(),
});
/** Áp kế hoạch vào trạng thái (mô phỏng) để thử lần 2. */
function applied(s: OrgState, acts: OrgAction[]): OrgState {
  const users = new Set(s.users);
  const groups = new Map([...s.groups].map(([k, v]) => [k, new Set(v)]));
  const depts = new Map(s.depts);
  const managers = new Map(s.managers);
  const titles = new Map(s.titles);
  for (const a of acts) {
    if (a.op === "create_user") users.add(a.username);
    else if (a.op === "create_group") groups.set(a.key, new Set());
    else if (a.op === "add_member") groups.get(a.group)?.add(a.username);
    else if (a.op === "set_dept") depts.set(a.key, { head: a.head, parent: a.parent });
    else if (a.op === "set_manager") managers.set(a.username, a.manager);
    else titles.set(a.username, a.title);
  }
  return { users, groups, depts, managers, titles };
}

describe("sơ đồ tổ chức evolu (CR-150b)", () => {
  it("lần 1 dựng đủ; lần 2 rỗng", () => {
    const s = base();
    const p1 = planOrg(s);
    expect(p1.missingPackGroups).toEqual([]);
    expect(p1.actions.filter((a) => a.op === "create_user")).toHaveLength(5);
    expect(planOrg(applied(s, p1.actions)).actions).toEqual([]);
  });
  it("không có thao tác xoá/gỡ (mọi op là tạo/thêm/đặt)", () => {
    const allowed = [
      "create_user",
      "create_group",
      "add_member",
      "set_dept",
      "set_manager",
      "set_title",
    ];
    for (const a of planOrg(base()).actions) expect(allowed).toContain(a.op);
  });
  it("cây: Ban Giám đốc là gốc (Thomas), 4 phòng con trực thuộc, trưởng phòng đúng người", () => {
    const sets = planOrg(base()).actions.filter((a) => a.op === "set_dept");
    const by = new Map(sets.map((a) => [(a as { key: string }).key, a]));
    expect(by.get(ORG_ROOT)).toMatchObject({ head: "thomas.tran", parent: null });
    expect((sets[0] as { key: string }).key).toBe(ORG_ROOT); // gốc trước con
    const heads: Record<string, string> = {
      "pb-kinh-doanh": "julian.bui",
      "pb-ky-thuat": "vio.ngo",
      "pb-cskh": "rowan.hoang",
      "pb-rnd": "edgar.nguyen",
    };
    for (const [k, h] of Object.entries(heads))
      expect(by.get(k)).toMatchObject({ head: h, parent: ORG_ROOT });
    expect(ORG_DEPTS).toHaveLength(5);
  });
  it("quản lý trực tiếp = Thomas (trừ Thomas), chức vụ đúng", () => {
    const acts = planOrg(base()).actions;
    const mgr = acts.filter((a) => a.op === "set_manager");
    expect(mgr).toHaveLength(4);
    for (const a of mgr) expect(a).toMatchObject({ manager: "thomas.tran" });
    expect(mgr.some((a) => (a as { username: string }).username === "thomas.tran")).toBe(false);
    expect(acts).toContainEqual({
      op: "set_title",
      username: "julian.bui",
      title: "Trưởng phòng kinh doanh / Business Analyst",
    });
    expect(acts).toContainEqual({ op: "set_title", username: "thomas.tran", title: "Giám đốc" });
    expect(ORG_PEOPLE).toHaveLength(5);
  });
  it("không đụng cái đã có: phòng đã là phòng ban, quản lý/chức vụ đã đặt, người có sẵn", () => {
    const s = base();
    const t: OrgState = {
      ...s,
      users: new Set([...s.users, "vio.ngo"]),
      groups: new Map([...s.groups, ["pb-ky-thuat", new Set(["vio.ngo"])]]),
      depts: new Map([["pb-ky-thuat", { head: "ai-do", parent: null }]]),
      managers: new Map([["vio.ngo", "ai-do"]]),
      titles: new Map([["vio.ngo", "Chức vụ cũ"]]),
    };
    const acts = planOrg(t).actions;
    expect(acts.some((a) => a.op === "set_dept" && a.key === "pb-ky-thuat")).toBe(false);
    expect(acts.some((a) => a.op === "set_manager" && a.username === "vio.ngo")).toBe(false);
    expect(acts.some((a) => a.op === "set_title" && a.username === "vio.ngo")).toBe(false);
    expect(acts.some((a) => a.op === "create_user" && a.username === "vio.ngo")).toBe(false);
  });
  it("nhóm ký chứa Thomas; thiếu nhóm gói ⇒ báo, không tạo", () => {
    expect(planOrg(base()).actions).toContainEqual({
      op: "add_member",
      group: "uat-nhan-ky",
      username: "thomas.tran",
    });
    const s = base();
    const t = { ...s, groups: new Map([...s.groups].filter(([k]) => k !== "contracts-editor")) };
    expect(planOrg(t).missingPackGroups).toEqual(["contracts-editor"]);
  });
  it("vai quy trình Nhận HĐ: phụ trách = Julian; duyệt = trưởng phòng Kinh doanh; ký = nhóm chứa Thomas", () => {
    expect(RECEIVE.owner).toBe("julian.bui");
    expect(ORG_RECEIVE).toMatchObject({
      approveDept: "pb-kinh-doanh",
      signer: "thomas.tran",
      signGroup: "uat-nhan-ky",
    });
    const s = JSON.stringify(receiveFlow("u1").stages);
    expect(s).toContain("pb-kinh-doanh");
    expect(s).not.toContain("uat-nhan-duyet");
  });
});
