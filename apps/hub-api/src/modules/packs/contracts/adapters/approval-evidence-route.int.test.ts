// CR-144 · route thật `GET …/approval-record/evidence/:evidenceId/files/:fileId` (Hono + packGuard, cổng giả): inline chỉ ảnh/PDF,
// luôn nosniff, người ngoài 403, người không đọc được hồ sơ 404, người được giao (không phải người tạo) lấy được tệp.
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { approvalRoutes } from "./approval.routes";

const T = "t1";
const CREATOR = "creator";
const ASSIGNEE = "assignee";
const ID = "0c144000-0000-4000-8000-0000000000c1";
const EV = "0c144000-0000-4000-8000-0000000000e1";
const FILE = "0c144000-0000-4000-8000-0000000000f1";
const URL_ = `/contracts/${ID}/approval-record/evidence/${EV}/files/${FILE}`;

const feat = (k: string, id: string) => ({ id, key: `contracts-${k}`, status: "on" as const });
const view = (groups: string[]): PackAccessView => ({
  catalog: async () => ({
    features: [feat("read", "fr"), feat("write", "fw"), feat("admin", "fa")],
    entitled: new Set([`${T}:fr`, `${T}:fw`, `${T}:fa`]),
    grantGroups: new Map([
      [`${T}:fr`, ["g-read"]],
      [`${T}:fw`, ["g-read"]],
      [`${T}:fa`, ["g-read"]],
    ]),
  }),
  user: async () => ({ tenantId: T, groupIds: new Set(groups) }),
});

function app(userId: string, groups: string[], mime: string, readers: string[]) {
  const a = new Hono<PackGuardVars>();
  a.use("*", async (c, next) => {
    c.set("user", { userId, tenantId: T, role: "member" });
    await next();
  });
  const noop = (async () => null) as never;
  a.route(
    "/",
    approvalRoutes(view(groups), {
      get: noop,
      act: noop,
      readSettings: noop,
      saveSettings: noop,
      evidenceFile: async (w) =>
        readers.includes(w.userId)
          ? { name: "tep.bin", mime, bytes: new Uint8Array([1, 2, 3]) }
          : null,
    }),
  );
  a.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return a;
}

describe("CR-144 · route tải tệp bằng chứng", () => {
  it("PDF inline là inline và không inline là attachment", async () => {
    const a = app(ASSIGNEE, ["g-read"], "application/pdf", [ASSIGNEE]);
    const on = await a.request(`${URL_}?inline=1`);
    expect(on.status).toBe(200);
    expect(on.headers.get("content-disposition")).toStartWith("inline;");
    expect(on.headers.get("x-content-type-options")).toBe("nosniff");
    expect(on.headers.get("content-security-policy")).toContain("sandbox");
    const off = await a.request(URL_);
    expect(off.headers.get("content-disposition")).toStartWith("attachment;");
    expect(off.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("SVG + inline vẫn attachment", async () => {
    const r = await app(ASSIGNEE, ["g-read"], "image/svg+xml", [ASSIGNEE]).request(
      `${URL_}?inline=1`,
    );
    expect(r.headers.get("content-disposition")).toStartWith("attachment;");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("người được giao (không phải người tạo) lấy được; người không đọc được hồ sơ ⇒ 404; người ngoài gói ⇒ 403", async () => {
    const readers = [ASSIGNEE];
    expect((await app(ASSIGNEE, ["g-read"], "image/png", readers).request(URL_)).status).toBe(200);
    expect((await app(CREATOR, ["g-read"], "image/png", ["x"]).request(URL_)).status).toBe(404);
    expect((await app(ASSIGNEE, [], "image/png", readers).request(URL_)).status).toBe(403);
  });
});
