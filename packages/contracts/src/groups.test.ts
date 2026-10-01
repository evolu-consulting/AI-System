import { describe, expect, test } from "bun:test";
import {
  type Group,
  GroupCreateRequestSchema,
  GroupListQuerySchema,
  type GroupMember,
  GroupMemberSchema,
  GroupMembersAddRequestSchema,
  GroupRefSchema,
  GroupSchema,
  GroupUpdateRequestSchema,
  GroupVersionConflictDetailsSchema,
  parseUsernameList,
} from "./index";
import { T0, T1, TENANT_ID, USER_ID } from "./test-fixtures";

const group: Group = {
  id: USER_ID,
  tenant_id: TENANT_ID,
  tenant_key: "acme",
  tenant_name: "Acme",
  key: "ke-toan",
  name: { vi: "Kế toán" },
  description: null,
  is_beta: false,
  member_count: 3,
  feature_count: 1,
  agent_count: 0,
  version: 2,
  updated_at: T1,
  updated_by: "an",
  created_at: T0,
};

describe("ADM-FR-62 · Group (spec M3 §3)", () => {
  test("Group hợp lệ; is_beta phải khớp key", () => {
    expect(GroupSchema.parse(group)).toEqual(group);
    expect(GroupSchema.safeParse({ ...group, is_beta: true }).success).toBe(false);
    const beta = { ...group, key: "beta-testers", is_beta: true };
    expect(GroupSchema.safeParse(beta).success).toBe(true);
    expect(GroupSchema.safeParse({ ...group, extra: 1 }).success).toBe(false);
  });

  test("GroupRef strict, refine beta", () => {
    const ref = { id: USER_ID, key: "beta-testers", name: { vi: "Beta" }, is_beta: true };
    expect(GroupRefSchema.parse(ref)).toEqual(ref);
    expect(GroupRefSchema.safeParse({ ...ref, is_beta: false }).success).toBe(false);
  });

  test("tạo: key trim/lower, description rỗng → null, mặc định null; key sai → lỗi", () => {
    const r = GroupCreateRequestSchema.parse({
      key: " Ke-Toan ",
      name: { vi: " Kế toán ", en: "" },
    });
    expect(r).toEqual({ key: "ke-toan", name: { vi: "Kế toán" }, description: null });
    const d = GroupCreateRequestSchema.parse({ key: "kt", name: { vi: "K" }, description: "  " });
    expect(d.description).toBeNull();
    for (const key of ["a", "a_b", "x".repeat(33)]) {
      expect(GroupCreateRequestSchema.safeParse({ key, name: { vi: "K" } }).success).toBe(false);
    }
    const long = { key: "kt", name: { vi: "K" }, description: "d".repeat(401) };
    expect(GroupCreateRequestSchema.safeParse(long).success).toBe(false);
    expect(
      GroupCreateRequestSchema.safeParse({ key: "kt", name: { vi: "x".repeat(65) } }).success,
    ).toBe(false);
  });

  test("sửa: cần version, không nhận key", () => {
    expect(GroupUpdateRequestSchema.parse({ version: 2, description: null })).toEqual({
      version: 2,
      description: null,
    });
    expect(GroupUpdateRequestSchema.safeParse({ name: { vi: "K" } }).success).toBe(false);
    expect(GroupUpdateRequestSchema.safeParse({ version: 2, key: "x" }).success).toBe(false);
  });

  test("list query nhận tenant_id; VERSION_CONFLICT details {current: Group, updated_at}", () => {
    expect(GroupListQuerySchema.parse({ tenant_id: TENANT_ID })).toMatchObject({ limit: 50 });
    const d = { current: group, updated_at: T1 };
    expect(GroupVersionConflictDetailsSchema.parse(d)).toEqual(d);
  });
});

describe("ADM-FR-62 · thành viên + dán danh sách (M3-R03)", () => {
  test("usernames: trim/lower, bỏ trùng giữ thứ tự, dry_run mặc định false", () => {
    const r = GroupMembersAddRequestSchema.parse({ usernames: [" An ", "binh", "an", "Nguyễn"] });
    expect(r).toEqual({ usernames: ["an", "binh", "nguyễn"], dry_run: false });
  });

  test("rỗng, > 500 phần tử (kể cả trùng, G8), phần tử > 64 ký tự → lỗi; 500 → được", () => {
    const req = (usernames: string[]) => GroupMembersAddRequestSchema.safeParse({ usernames });
    expect(req([]).success).toBe(false);
    expect(req(Array(501).fill("an")).success).toBe(false);
    expect(req(["x".repeat(65)]).success).toBe(false);
    expect(req(["  "]).success).toBe(false);
    expect(req(Array.from({ length: 500 }, (_, i) => `u${i}`)).success).toBe(true);
  });

  test("parseUsernameList tách xuống dòng/phẩy/khoảng trắng, chữ thường, bỏ rỗng/trùng", () => {
    expect(parseUsernameList(" An,binh\n\ncuong  an\r\nDUNG,,")).toEqual([
      "an",
      "binh",
      "cuong",
      "dung",
    ]);
    expect(parseUsernameList("")).toEqual([]);
  });

  test("GroupMember: other_groups ≤ 3", () => {
    const m: GroupMember = {
      user_id: USER_ID,
      username: "an",
      display_name: "An",
      role: "member",
      status: "active",
      locked_by_tenant: false,
      last_login_at: null,
      added_at: T0,
      added_by: null,
      other_groups: [],
      other_groups_total: 0,
    };
    expect(GroupMemberSchema.parse(m)).toEqual(m);
    const ref = { id: TENANT_ID, key: "kt", name: { vi: "K" }, is_beta: false };
    const many = { ...m, other_groups: [ref, ref, ref, ref], other_groups_total: 4 };
    expect(GroupMemberSchema.safeParse(many).success).toBe(false);
  });
});
