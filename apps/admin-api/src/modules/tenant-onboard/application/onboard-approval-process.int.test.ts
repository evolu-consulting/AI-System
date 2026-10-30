// CR-105 L5 · int: yaml `approval_process` => slot assignment, via the HTTP adapter against a real hub-api.
// SKIPPED ON PURPOSE until L2a (`pl-library-api`) merges: needs hub `GET /process-defs?kind=library` and
// `PUT /tenants/:tid/process-slots/:slot`. After L2a: replace `test.skip` with `test`, wire a hub-api test instance +
// platform_admin access token (see tests/acceptance/NITI/onboard.int.test.ts for DB/actor setup), publish a library def
// for slot `contracts.approval`, then run onboardTenant(db, spec, actor, { url, accessToken }).
import { describe, test } from "bun:test";

describe("onboard approval_process (needs L2a)", () => {
  test.skip("approval_process trong yaml ⇒ gán khe", async () => {
    // expect: report.approval.state === "assigned"; GET /process-defs/:id/assignments lists the new tenant.
  });

  test.skip("ký hiệu sai ⇒ lỗi bước, tenant vẫn tạo", async () => {
    // expect: report.approval = { state: "error", error: "PROCESS_NOT_FOUND" | "PROCESS_NOT_PUBLISHED" };
    // report.tenant.created === true and admin.tenants row exists.
  });
});
