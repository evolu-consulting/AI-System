// HUB-FR-67 · spec H4b2 §3 B · P08 ở mức route (không DB): `:id` không uuid ⇒ 400; thân sai (0/6 bước, key sai, PUT có
// `key`, DELETE thiếu `version`) ⇒ 400 trước khi mở transaction. Ca chạm DB ở `tests/acceptance/H4b2/profiles.int`.
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { mapError } from "../../../lib/errors";
import { profileRoutes } from "./profiles.routes";
import { ProfilesService } from "./profiles.service";

const noDb = new Proxy(
  {},
  {
    get: () => {
      throw new Error("DB must not be touched");
    },
  },
);

function app(): Hono<AuthVars> {
  const a = new Hono<AuthVars>();
  a.onError((err, c) => {
    const m = mapError(err);
    return c.json(m.body, m.status);
  });
  a.route("/s", profileRoutes(new ProfilesService({ db: noDb as never, audit: noDb as never })));
  return a;
}
type Err = { error: { code: string; details?: { issues?: { path: string[] }[] } } };
const send = async (method: string, path: string, body?: unknown) => {
  const r = await app().request(`/s${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const j = (await r.json()) as Err;
  return {
    status: r.status,
    code: j.error.code,
    paths: (j.error.details?.issues ?? []).map((i) => i.path.join(".")),
  };
};
const ID = "a4b20000-0000-4000-8000-000000000001";
const st = (provider_key = "fake-cli", model: string | null = null) => ({
  provider_key,
  model,
  on: [],
});

describe("profileRoutes · 400 không chạm DB", () => {
  it("P08 · :id không uuid ⇒ 400 cho GET/PUT/DELETE", async () => {
    for (const [m, p] of [
      ["GET", "/model-profiles/abc"],
      ["PUT", "/model-profiles/abc"],
      ["DELETE", "/model-profiles/abc?version=1"],
    ] as const)
      expect(await send(m, p, m === "PUT" ? {} : undefined)).toMatchObject({
        status: 400,
        code: "VALIDATION_ERROR",
        paths: ["id"],
      });
  });

  it("P08 · POST 0 bước / 6 bước / key sai ⇒ 400", async () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((m) => st("fake-cli", m));
    for (const body of [
      { key: "qc-a", steps: [] },
      { key: "qc-b", steps: six },
      { key: "QC B", steps: [st()] },
    ])
      expect(await send("POST", "/model-profiles", body)).toMatchObject({
        status: 400,
        code: "VALIDATION_ERROR",
      });
  });

  it("P04 · PUT có `key` (bất biến) / thiếu version ⇒ 400; DELETE thiếu version ⇒ 400", async () => {
    const put = await send("PUT", `/model-profiles/${ID}`, { version: 1, key: "x", steps: [st()] });
    expect([put.status, put.code]).toEqual([400, "VALIDATION_ERROR"]);
    const noV = await send("PUT", `/model-profiles/${ID}`, { steps: [st()] });
    expect(noV.paths).toContain("version");
    const del = await send("DELETE", `/model-profiles/${ID}`);
    expect([del.status, del.code]).toEqual([400, "VALIDATION_ERROR"]);
  });

  it("bước có `on` ngoài enum / model rỗng ⇒ 400 path steps.0.*", async () => {
    const r = await send("POST", "/model-profiles", {
      key: "qc-c",
      steps: [{ provider_key: "fake-cli", model: "", on: ["boom"] }],
    });
    expect(r.status).toBe(400);
    expect(r.paths.every((p) => p.startsWith("steps.0"))).toBe(true);
  });
});
