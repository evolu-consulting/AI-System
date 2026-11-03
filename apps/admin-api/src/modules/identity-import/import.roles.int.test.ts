// CR-112 S6 · ADM-FR-81: importer identity (N5) tạo tenant MỚI + 3 Group vai ⇒ cũng tạo 3 hàng vai mặc định trỏ đúng Group
// (như bật gói). Dữ liệu export GIẢ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxN5,
  mkExport,
  startN5,
  tenantOfOrg,
  userX,
} from "../../../../../tests/acceptance/N5/_support/n5";
import { runIdentityImport } from "./identity-import.run";

let c: CtxN5;
beforeAll(async () => {
  c = await startN5();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

describe("CR-112 S6 · ADM-FR-81 · import tạo vai mặc định", () => {
  it("ADM-FR-81 · import tenant mới ⇒ 3 vai mặc định (viewer/editor/owner) trỏ Group vai contracts", async () => {
    const raw = mkExport(
      [{ id: "org-s6", name: "S6 Co", tenant_key: "s6-co" }],
      [userX("own@s6.test", "org-s6", "owner")],
    );
    await runIdentityImport(c.db, raw, { actorId: c.padmin, apply: true });
    const tid = (await tenantOfOrg(c.sql, "org-s6"))[0]?.id as string;
    const rows = await c.sql<{ key: string; level: string; gk: string }[]>`
      select r.key, r.level, g.key as gk from admin.app_roles r join admin.groups g on g.id = r.group_id
      where r.tenant_id = ${tid} and r.is_default order by r.key`;
    expect([...rows]).toEqual([
      { key: "editor", level: "write", gk: "contracts-editor" },
      { key: "owner", level: "admin", gk: "contracts-owner" },
      { key: "viewer", level: "read", gk: "contracts-viewer" },
    ]);
  });
});
