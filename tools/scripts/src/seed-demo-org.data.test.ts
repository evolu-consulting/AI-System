// CR-139c · luật thuần của demo:org: nhóm mong muốn suy từ file phòng ban; diff chỉ đụng người trong danh sách quản lý.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseSpec } from "../../../apps/admin-api/src/modules/tenant-onboard/adapters/onboard.schema";
import { DEMO_PEOPLE, diffMembers, emailOf, planGroups, SAMPLES } from "./seed-demo-org.data";

const spec = (() => {
  const r = parseSpec(readFileSync("deploy/tenants/demo.yaml", "utf8"));
  if (!r.ok) throw new Error("demo.yaml không hợp lệ");
  return r.spec;
})();
const want = (key: string) => [...(planGroups(spec).find((g) => g.key === key)?.want ?? [])].sort();

describe("demo:org · nhóm mong muốn", () => {
  it("phòng ban lấy từ demo.yaml (trưởng phòng cũng là thành viên)", () => {
    expect(want("pb-kinh-doanh")).toEqual(["binh.tran", "cuong.le", "demo-editor", "dung.pham"]);
    expect(want("pb-giam-doc")).toEqual(["demo-owner"]);
    expect(want("pb-mua-hang")).toEqual(["phuc.do", "tung.mai"]);
  });
  it("mọi người đúng một phòng ban, Thủ quỹ chỉ xem, Giám đốc toàn quyền", () => {
    const depts = new Set([spec.root.key, ...spec.departments.map((d) => d.key)]);
    for (const p of DEMO_PEOPLE)
      expect(
        planGroups(spec).filter((g) => depts.has(g.key) && g.want.has(p.username)).length,
      ).toBe(1);
    expect(want("contracts-viewer")).toEqual(["hung.dinh"]);
    expect(want("contracts-owner")).toEqual(["demo-owner"]);
    expect(want("nguoi-ky-hd")).toEqual(["demo-owner", "em.hoang"]);
  });
  it("email người dùng khớp file phòng ban; người gửi mẫu có trong danh sách", () => {
    const emails = new Set([
      spec.root.head,
      ...spec.departments.flatMap((d) => [d.head, ...d.members]),
    ]);
    for (const p of DEMO_PEOPLE) expect(emails.has(emailOf(p.username))).toBe(true);
    for (const s of SAMPLES) expect(DEMO_PEOPLE.some((p) => p.username === s.by)).toBe(true);
  });
  it("diff: thêm người thiếu, bớt người quản lý đứng sai chỗ, không đụng người ngoài danh sách", () => {
    const d = diffMembers(
      new Set(["a", "x", "outsider"]),
      new Set(["a", "b"]),
      new Set(["a", "b", "x"]),
    );
    expect(d).toEqual({ add: ["b"], remove: ["x"] });
  });
});
