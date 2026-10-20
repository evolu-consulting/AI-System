// niti-onboard · `--into-tenant`: chỉ org được gắn + user của nó (+ user không org — N5 vẫn báo NO_ORG); báo org nguồn.
import { describe, expect, test } from "bun:test";
import type { SourceDoc } from "./context";
import { memberships, scopeToOrg, sourceOrgs } from "./map-identity.rules";

const d = (id: string, src: Record<string, unknown>): SourceDoc => ({ id, src: { id, ...src } });
const orgs = [d("o1", { name: "An Nam" }), d("o2", { name: "Bình Minh" })];
const users = ["a@x.vn", "b@x.vn", "c@x.vn", "staff@x.vn"].map((e) => d(e, { email: e }));
const members = memberships([
  d("a@x.vn", { email: "a@x.vn", org_id: "o1", role: "owner" }),
  d("b@x.vn", { email: "b@x.vn", org_id: "o1", role: "editor" }),
  d("c@x.vn", { email: "c@x.vn", org_id: "o2", role: "owner" }),
]);

describe("niti-onboard · scopeToOrg", () => {
  test("onlyOrg null ⇒ giữ nguyên (I1 gốc)", () => {
    const r = scopeToOrg(null, { orgs, users }, members);
    expect([r.orgs.length, r.users.length, r.excludedUsers]).toEqual([2, 4, 0]);
  });

  test("onlyOrg o1 ⇒ org o1, user o1 + user không org; loại user o2", () => {
    const r = scopeToOrg("o1", { orgs, users }, members);
    expect(r.orgs.map((x) => x.id)).toEqual(["o1"]);
    expect(r.users.map((x) => x.id)).toEqual(["a@x.vn", "b@x.vn", "staff@x.vn"]);
    expect(r.excludedUsers).toBe(1);
  });

  test("onlyOrg '' (tenant chưa gắn, dry-run) ⇒ 0 org, chỉ user không org", () => {
    const r = scopeToOrg("", { orgs, users }, members);
    expect(r.orgs).toEqual([]);
    expect(r.users.map((x) => x.id)).toEqual(["staff@x.vn"]);
  });

  test("sourceOrgs: id, tên, số membership", () => {
    expect(sourceOrgs(orgs, members)).toEqual([
      { id: "o1", name: "An Nam", members: 2 },
      { id: "o2", name: "Bình Minh", members: 1 },
    ]);
  });
});
