// PK-FR-06 · N1 plan §6: `PackFiles` với uow/client giả — org theo tenant gọi, hàng lạ/lệch org ⇒ không gọi FileBox, log không
// mang `file_id`; route: 302 khi có, 404 giống hệt khi không, 403 trước khi chạm file.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { mapError } from "../../../../lib/errors";
import { orgForTenant, type PackFileRow } from "../application/pack-files.ports";
import type { PackWho } from "../application/ports";
import { createPackFiles, type PackFileboxClient, type PackFilesRepos } from "./pack-files.filebox";
import { packFilesRoutes } from "./pack-files.routes";
import type { PackAccessView, PackGuardVars } from "./pack-guard.middleware";

const A = "a5e10000-0000-4000-8000-0000000000a1";
const B = "a5e10000-0000-4000-8000-0000000000b1";
const ROW = "a5e10000-0000-4000-8000-000000000005";
const who = (tenantId: string): PackWho => ({ tenantId, userId: "u1" });

function setup(rows: Map<string, PackFileRow & { tenantId: string }>) {
  const calls: { org: string; op: string; arg: string }[] = [];
  const logs: { msg: string; fields?: Record<string, unknown> }[] = [];
  const inserted: unknown[] = [];
  const client = (org: string): PackFileboxClient => ({
    postFile: async (name) => {
      calls.push({ org, op: "post", arg: name });
      return { fileId: "fb-new", versionId: "v1" };
    },
    getLink: async (fileId) => {
      calls.push({ org, op: "link", arg: fileId });
      return `http://fb/d/${fileId}-tok`;
    },
    deleteFile: async (fileId) => {
      calls.push({ org, op: "delete", arg: fileId });
      return "deleted";
    },
  });
  const uow = {
    tenant: async <T>(w: PackWho, fn: (r: PackFilesRepos) => Promise<T>) => {
      const mine = (id: string) => {
        const r = rows.get(id);
        return r && r.tenantId === w.tenantId ? { id: r.id, org: r.org, fileId: r.fileId } : null;
      };
      return fn({
        files: {
          find: async (id) => mine(id),
          insert: async (r) => {
            inserted.push(r);
          },
          softDelete: async (id) => {
            const r = mine(id);
            if (r) rows.delete(id);
            return r;
          },
        },
      });
    },
  };
  const files = createPackFiles({
    packKey: "pkdemo",
    uow,
    client,
    log: { warn: (msg, fields) => logs.push({ msg, fields }) },
    newId: () => ROW,
  });
  return { files, calls, logs, inserted };
}

const rowA = () => new Map([[ROW, { id: ROW, org: orgForTenant(A), fileId: "fb-A", tenantId: A }]]);

describe("PackFiles (FileBox org theo tenant)", () => {
  test("orgForTenant = t_<tenant>", () => {
    expect(orgForTenant(A)).toBe(`t_${A}`);
  });
  test("link hàng của mình ⇒ URL, client đúng org tenant", async () => {
    const s = setup(rowA());
    expect(await s.files.link(who(A), ROW)).toBe("http://fb/d/fb-A-tok");
    expect(s.calls).toEqual([{ org: `t_${A}`, op: "link", arg: "fb-A" }]);
  });
  test("tenant khác / hàng lạ ⇒ null, FileBox không bị gọi", async () => {
    const s = setup(rowA());
    expect(await s.files.link(who(B), ROW)).toBeNull();
    expect(await s.files.link(who(A), "a5e10000-0000-4000-8000-000000000099")).toBeNull();
    expect(s.calls).toEqual([]);
  });
  test("org lệch ⇒ null + log không chứa file_id, không gọi FileBox", async () => {
    const s = setup(new Map([[ROW, { id: ROW, org: `t_${B}`, fileId: "fb-X", tenantId: A }]]));
    expect(await s.files.link(who(A), ROW)).toBeNull();
    expect(s.calls).toEqual([]);
    expect(s.logs).toEqual([
      { msg: "pack-file-org-mismatch", fields: { pack: "pkdemo", row_id: ROW } },
    ]);
  });
  test("put ⇒ POST org tenant + ghi hàng org/file_id; remove ⇒ xoá mềm + xoá FileBox", async () => {
    const s = setup(new Map());
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await s.files.put(who(A), { name: "a.pdf", mime: "application/pdf", bytes })).toEqual({
      id: ROW,
    });
    expect(s.calls).toEqual([{ org: `t_${A}`, op: "post", arg: "a.pdf" }]);
    expect(s.inserted).toEqual([
      {
        id: ROW,
        org: `t_${A}`,
        fileId: "fb-new",
        versionId: "v1",
        name: "a.pdf",
        mime: "application/pdf",
        sizeBytes: 3,
        createdBy: "u1",
      },
    ]);
    const r = setup(rowA());
    expect(await r.files.remove(who(B), ROW)).toBe(false);
    expect(await r.files.remove(who(A), ROW)).toBe(true);
    expect(r.calls).toEqual([{ org: `t_${A}`, op: "delete", arg: "fb-A" }]);
  });
});

function view(actions: string[], tid: string): PackAccessView {
  const feats = ["read", "write", "admin"].map((a, i) => ({
    id: `f${i}`,
    key: `pkdemo-${a}`,
    status: "on",
  }));
  const granted = feats.filter((f) => actions.some((a) => f.key.endsWith(a)));
  return {
    catalog: async () => ({
      features: feats,
      entitled: new Set(feats.map((f) => `${tid}:${f.id}`)),
      grantGroups: new Map(granted.map((f) => [`${tid}:${f.id}`, ["g1"]])),
    }),
    user: async () => ({ tenantId: tid, groupIds: new Set(["g1"]) }),
  };
}

function app(tid: string, actions: string[]) {
  const s = setup(rowA());
  const r = new Hono<PackGuardVars>();
  r.use(async (c, next) => {
    c.set("user", { userId: "u1", tenantId: tid, role: "member" } satisfies AuthUser);
    await next();
  });
  r.route("/", packFilesRoutes(view(actions, tid), "pkdemo", s.files));
  r.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return { r, s };
}

describe("GET /files/:id/content", () => {
  test("hàng của mình ⇒ 302 Location = link FileBox", async () => {
    const { r } = app(A, ["read"]);
    const res = await r.request(`/files/${ROW}/content`);
    expect([res.status, res.headers.get("location")]).toEqual([302, "http://fb/d/fb-A-tok"]);
  });
  test("tenant khác, hàng lạ, id sai dạng ⇒ 404 giống hệt nhau", async () => {
    const { r, s } = app(B, ["read"]);
    const bodies = [];
    for (const id of [ROW, "a5e10000-0000-4000-8000-000000000099", "x"]) {
      const res = await r.request(`/files/${id}/content`);
      bodies.push({ s: res.status, b: await res.json() });
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0]?.s).toBe(404);
    expect(s.calls).toEqual([]);
  });
  test("không có quyền read ⇒ 403 PACK_FORBIDDEN, không chạm file", async () => {
    const { r, s } = app(A, []);
    const res = await r.request(`/files/${ROW}/content`);
    expect([res.status, ((await res.json()) as { error: { code: string } }).error.code]).toEqual([
      403,
      "PACK_FORBIDDEN",
    ]);
    expect(s.calls).toEqual([]);
  });
});
