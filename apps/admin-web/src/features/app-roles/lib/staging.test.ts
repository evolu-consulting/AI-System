// CR-112 · ADM-FR-80, ADM-FR-82 · thay đổi chưa lưu của Phân quyền (diff, thứ tự thao tác) + chạy lô và xử lý lỗi 409.
import { describe, expect, test } from "bun:test";
import type { AppRole } from "@ai/contracts/app-roles";
import { ApiError } from "@/lib/http";
import { describeRoleError, isVersionConflict } from "./errors";
import {
  buildOps,
  emptyStaged,
  isMember,
  memberCountAfter,
  type OpsApi,
  pendingCount,
  runOps,
  setMembership,
  stageCreate,
  stageDelete,
  stageEdit,
} from "./staging";

const role = (id: string, over: Partial<AppRole> = {}): AppRole => ({
  id,
  tenant_id: "t",
  pack: "contracts",
  key: id,
  name: { vi: `Vai ${id}` },
  level: "write",
  group_id: `g-${id}`,
  is_default: false,
  member_count: 2,
  ceiling: "admin",
  effective: true,
  version: 3,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("diff chưa lưu", () => {
  test("đổi tên/mức về đúng giá trị gốc ⇒ không còn là thay đổi", () => {
    const r = role("a");
    let s = stageEdit(emptyStaged(), r, { name: "Mới", level: "admin" });
    expect(pendingCount(s)).toBe(1);
    expect(s.edits.a).toEqual({ name: "Mới", level: "admin" });
    s = stageEdit(s, r, { name: "Vai a" });
    expect(s.edits.a).toEqual({ level: "admin" });
    s = stageEdit(s, r, { level: "write" });
    expect(pendingCount(s)).toBe(0);
  });

  test("gán rồi gỡ cùng một người ⇒ về 0; gỡ người đã có rồi gán lại ⇒ về 0", () => {
    let s = setMembership(emptyStaged(), "a", "u1", false, true);
    expect(isMember(s, "a", "u1", false)).toBe(true);
    expect(pendingCount(s)).toBe(1);
    s = setMembership(s, "a", "u1", false, false);
    expect(pendingCount(s)).toBe(0);
    s = setMembership(s, "a", "u2", true, false);
    expect(isMember(s, "a", "u2", true)).toBe(false);
    expect(memberCountAfter(s, role("a"))).toBe(1);
    s = setMembership(s, "a", "u2", true, true);
    expect(pendingCount(s)).toBe(0);
  });

  test("xoá vai tạm bỏ luôn người đã gán; xoá vai đã lưu bỏ sửa dở", () => {
    let s = stageCreate(emptyStaged(), {
      tempId: "tmp1",
      pack: "contracts",
      name: "N",
      level: "read",
    });
    s = setMembership(s, "tmp1", "u1", false, true);
    s = stageDelete(s, "tmp1");
    expect(pendingCount(s)).toBe(0);
    s = stageEdit(emptyStaged(), role("a"), { level: "admin" });
    s = stageDelete(s, "a");
    expect(s.edits).toEqual({});
    expect(s.deleted).toEqual(["a"]);
  });
});

describe("buildOps / runOps", () => {
  const fake = (fail?: (op: string) => unknown) => {
    const log: string[] = [];
    const step = (name: string) => {
      log.push(name);
      const err = fail?.(name);
      if (err) throw err;
    };
    const api: OpsApi = {
      create: async (b) => {
        step(`create:${b.name.vi}`);
        return { id: "real-1" };
      },
      update: async (id, b) => step(`update:${id}:v${b.version}:${b.level ?? ""}`),
      addMembers: async (id, u) => step(`add:${id}:${u.join(",")}`),
      removeMember: async (id, u) => step(`rm:${id}:${u}`),
      remove: async (id) => step(`del:${id}`),
    };
    return { api, log };
  };

  test("thứ tự tạo ⇒ sửa ⇒ gán/gỡ ⇒ xoá; gán vào vai tạm dùng id thật vừa tạo", async () => {
    const roles = [role("a"), role("b")];
    let s = stageCreate(emptyStaged(), {
      tempId: "tmp1",
      pack: "contracts",
      name: "Mới",
      level: "read",
    });
    s = setMembership(s, "tmp1", "u1", false, true);
    s = stageEdit(s, roles[0] as AppRole, { level: "admin" });
    s = setMembership(s, "a", "u9", true, false);
    s = stageDelete(s, "b");
    const ops = buildOps(s, roles);
    expect(ops.map((o) => o.kind)).toEqual([
      "create",
      "update",
      "addMembers",
      "removeMember",
      "delete",
    ]);
    const { api, log } = fake();
    const r = await runOps(ops, api);
    expect(r).toEqual({ applied: 5, total: 5, error: null });
    expect(log).toEqual(["create:Mới", "update:a:v3:admin", "add:real-1:u1", "rm:a:u9", "del:b"]);
  });

  test("409 VERSION_CONFLICT dừng lô, báo số thao tác đã ghi và câu 'tải lại'", async () => {
    const conflict = new ApiError(409, "VERSION_CONFLICT", "x", { current: {} });
    const roles = [role("a"), role("b")];
    let s = stageEdit(emptyStaged(), roles[0] as AppRole, { level: "admin" });
    s = stageEdit(s, roles[1] as AppRole, { level: "read" });
    s = setMembership(s, "a", "u1", false, true);
    const { api, log } = fake((op) => (op.startsWith("update:b") ? conflict : null));
    const r = await runOps(buildOps(s, roles), api);
    expect(r.applied).toBe(1);
    expect(r.total).toBe(3);
    expect(isVersionConflict(r.error)).toBe(true);
    expect(describeRoleError(r.error).key).toBe("appRoles.error.conflict");
    expect(log).toEqual(["update:a:v3:admin", "update:b:v3:read"]);
  });
});

describe("describeRoleError", () => {
  test("mã riêng của vai", () => {
    const e = (code: string, details?: unknown) =>
      describeRoleError(new ApiError(409, code as never, "m", details));
    expect(e("DEFAULT_ROLE_PROTECTED").key).toBe("appRoles.error.defaultProtected");
    expect(e("ROLE_HAS_MEMBERS", { member_count: 4 })).toEqual({
      key: "appRoles.error.hasMembers",
      params: { count: 4 },
    });
    expect(e("PACK_NOT_ROLEABLE").key).toBe("appRoles.error.notRoleable");
    expect(e("ROLE_KEY_RESERVED").key).toBe("appRoles.error.keyReserved");
    expect(e("ROLE_GROUP_MANAGED").key).toBe("groups.error.roleManaged");
    expect(e("EXTERNAL_USER_NOT_ALLOWED", { usernames: ["dt"] }).key).toBe(
      "errors.externalNotAllowed",
    );
  });
});
