// CR-127 · Z8: `withDeleteCan` đặt `can.delete` theo luật xoá.
import { describe, expect, it } from "bun:test";
import type { Can } from "./contract-can";
import { withDeleteCan } from "./detail-delete-role";

const base = {
  status: "draft",
  created_by: "u1",
  owner_user_id: null,
  can: {
    submit: true,
    withdraw: false,
    recreate: false,
    new_version: false,
    hold: false,
    release: false,
  } as Can,
};
const run = (status: string, uid: string, role: { admin: boolean; write: boolean }) =>
  withDeleteCan(
    async () => ({ ...base, status }),
    async () => role,
  )({ tenantId: "t", userId: uid }, "c");

describe("withDeleteCan", () => {
  it("draft + người tạo có quyền ghi ⇒ true; người khác ⇒ false; admin ⇒ true", async () => {
    expect((await run("draft", "u1", { admin: false, write: true }))?.can.delete).toBe(true);
    expect((await run("draft", "u2", { admin: false, write: true }))?.can.delete).toBe(false);
    expect((await run("draft", "u2", { admin: true, write: false }))?.can.delete).toBe(true);
  });
  it("ngoài draft: người tạo ⇒ false; HĐ không có ⇒ null", async () => {
    expect((await run("processing", "u1", { admin: false, write: true }))?.can.delete).toBe(false);
    const none = await withDeleteCan(
      async () => null,
      async () => ({ admin: true, write: true }),
    )({ tenantId: "t", userId: "u" }, "c");
    expect(none).toBeNull();
  });
});
