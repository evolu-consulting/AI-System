// HUB-FR-131 · HUB-BR-37 · HUB-BR-40 · K1-AC01 · plan §2.2 `kh.check.rules.ts` + §3.1 (10 bước, mã lỗi/cảnh báo) · Q2 ·
// test-plan K1 §4 R30–R45: `evaluateKhCheck(probe)` thuần ⇒ KhCheckResult; `khCheckShouldContinue` dừng sau lỗi url/health/
// token/credentials. Probe có thêm `sharedProjects` (project `read_only` của tenant — test-plan §8 G3, cần cho Q2).
import { describe, expect, it } from "bun:test";
import { fn, loadCheck, loadHubAdmin, schema } from "./_rules";

const m = await loadCheck();
const AT = "2026-10-13T08:00:00.000Z";
const CAPS = {
  kh_version: "v6.4",
  api_versions: ["v1"],
  capabilities: [{ name: "retrieval", version: "1.0.0", status: "beta" }],
};
const manifest = (o: { rev?: number; lanes?: boolean | null; ks?: string } = {}) => {
  const settings = o.lanes === null ? {} : { include_people_lanes: o.lanes ?? false };
  return {
    status: 200,
    body: {
      ns: "acme_ns",
      manifest_rev: o.rev ?? 1,
      manifest: { keyspaces: [{ keyspace: o.ks ?? "step", dims: ["role", "step"] }], settings },
    },
  };
};
const OKP = {
  url: { ok: true, localDev: false },
  health: 200,
  version: "v6.4",
  meNoToken: 401,
  credentials: "ok",
  token: 200,
  capabilities: CAPS,
  me: { status: 200, body: { kind: "client", ns: "acme_ns", projects: ["proj-a", "proj-s"] } },
  manifest: manifest(),
  ns: "acme_ns",
  keyspace: "step",
  declaredProjects: ["proj-a"],
  sharedProjects: [] as string[],
};
// biome-ignore lint/suspicious/noExplicitAny: probe từng ca
const ev = (patch: Record<string, any> = {}) => fn(m, "evaluateKhCheck")({ ...OKP, ...patch }, AT);
// biome-ignore lint/suspicious/noExplicitAny: kết quả nạp động
const codes = (r: any, level?: string): string[] =>
  // biome-ignore lint/suspicious/noExplicitAny: item nạp động
  (r?.items ?? []).filter((i: any) => !level || i.level === level).map((i: any) => i.code);
// biome-ignore lint/suspicious/noExplicitAny: item nạp động
const item = (r: any, code: string) => (r?.items ?? []).find((i: any) => i.code === code);

describe("R30 · KH hợp lệ ⇒ ok [K1-AC01]", () => {
  it("HUB-FR-131 · K1-AC01 · R30 · đủ 10 bước đạt ⇒ status ok, chỉ cảnh báo embedder, kh_version + keyspace_dims, checked_at", async () => {
    const r = ev();
    expect(r.status).toBe("ok");
    expect(r.checked_at).toBe(AT);
    expect(r.kh_version).toBe("v6.4");
    expect(r.keyspace_dims).toEqual(["role", "step"]);
    expect(codes(r)).toEqual(["kh_embedder_multilingual"]);
    expect(item(r, "kh_embedder_multilingual")?.level).toBe("warning");
    const c = await loadHubAdmin();
    expect(schema(c, "KhCheckResultSchema").safeParse(r).success).toBe(true);
  });
});

describe("R31–R34 · bước 1–5 [plan §3.1]", () => {
  it("HUB-BR-37 · R31 · url bị từ chối ⇒ kh_url_not_allowed (lỗi), không mã bước sau, vẫn có cảnh báo embedder", () => {
    const r = ev({
      url: { ok: false },
      health: null as never,
      version: null,
      meNoToken: null,
      credentials: null,
      token: null,
      capabilities: null,
      me: null,
      manifest: null,
    });
    expect(r.status).toBe("error");
    expect(codes(r, "error")).toEqual(["kh_url_not_allowed"]);
    expect(codes(r)).toContain("kh_embedder_multilingual");
  });
  it("HUB-FR-131 · R32 · /health ≠ 200 ⇒ kh_unreachable {status}; timeout ⇒ kh_timeout; network ⇒ kh_unreachable", () => {
    const stop = {
      version: null,
      meNoToken: null,
      credentials: null,
      token: null,
      capabilities: null,
      me: null,
      manifest: null,
    };
    const r = ev({ health: 503, ...stop });
    expect(codes(r, "error")).toEqual(["kh_unreachable"]);
    expect(item(r, "kh_unreachable")?.params).toEqual({ status: 503 });
    expect(codes(ev({ health: "timeout", ...stop }), "error")).toEqual(["kh_timeout"]);
    expect(codes(ev({ health: "network", ...stop }), "error")).toEqual(["kh_unreachable"]);
  });
  it("HUB-FR-131 · R33 · /version < 6.4 ⇒ kh_version_too_old {found}; không đọc được ⇒ kh_version_too_old", () => {
    const r = ev({ version: "v6.3" });
    expect(codes(r, "error")).toEqual(["kh_version_too_old"]);
    expect(item(r, "kh_version_too_old")?.params).toEqual({ found: "v6.3" });
    expect(codes(ev({ version: null }), "error")).toEqual(["kh_version_too_old"]);
  });
  it("HUB-BR-40 · K1-AC01 · R34 · /v1/me không token 2xx ⇒ kh_auth_disabled (lỗi); localDev ⇒ kh_auth_disabled_dev (cảnh báo, ok)", () => {
    expect(codes(ev({ meNoToken: 200 }), "error")).toEqual(["kh_auth_disabled"]);
    const dev = ev({ meNoToken: 200, url: { ok: true, localDev: true } });
    expect(dev.status).toBe("ok");
    expect(codes(dev, "warning")).toContain("kh_auth_disabled_dev");
    expect(codes(ev({ meNoToken: 403 }), "error")).toEqual([]);
  });
  it("HUB-FR-137 · R35 · credentials sai ⇒ kh_credentials_invalid; token 401 ⇒ kh_credentials_rejected; 500 ⇒ kh_token_failed {status}", () => {
    const stop = { capabilities: null, me: null, manifest: null };
    expect(codes(ev({ credentials: "invalid", token: null, ...stop }), "error")).toEqual([
      "kh_credentials_invalid",
    ]);
    expect(codes(ev({ token: 401, ...stop }), "error")).toEqual(["kh_credentials_rejected"]);
    const r = ev({ token: 500, ...stop });
    expect(codes(r, "error")).toEqual(["kh_token_failed"]);
    expect(item(r, "kh_token_failed")?.params).toEqual({ status: 500 });
  });
});

describe("R36–R41 · bước 6–10 [plan §3.1 · Q2]", () => {
  it("HUB-FR-131 · R36 · capabilities thiếu v1 ⇒ kh_api_v1_missing; thiếu/off retrieval ⇒ kh_capability_missing {name:retrieval}", () => {
    expect(codes(ev({ capabilities: { ...CAPS, api_versions: ["v0"] } }), "error")).toEqual([
      "kh_api_v1_missing",
    ]);
    const miss = ev({
      capabilities: { ...CAPS, capabilities: [{ name: "events", status: "beta" }] },
    });
    expect(codes(miss, "error")).toEqual(["kh_capability_missing"]);
    expect(item(miss, "kh_capability_missing")?.params).toEqual({ name: "retrieval" });
    const off = ev({
      capabilities: { ...CAPS, capabilities: [{ name: "retrieval", status: "off" }] },
    });
    expect(codes(off, "error")).toEqual(["kh_capability_missing"]);
  });
  it("HUB-BR-40 · K1-AC01 · R37 · /v1/me kind=local ⇒ kh_auth_disabled; kind khác client ⇒ kh_identity_unexpected {kind}", () => {
    const me = (body: object) => ({
      me: { status: 200, body: { ns: "acme_ns", projects: ["proj-a"], ...body } },
    });
    expect(codes(ev(me({ kind: "local" })), "error")).toEqual(["kh_auth_disabled"]);
    const p = ev(me({ kind: "person" }));
    expect(codes(p, "error")).toEqual(["kh_identity_unexpected"]);
    expect(item(p, "kh_identity_unexpected")?.params).toEqual({ kind: "person" });
  });
  it("HUB-BR-35 · R38 · ns của khoá khác ⇒ kh_ns_mismatch {found}; /v1/me 404 ⇒ kh_ns_not_active", () => {
    const r = ev({
      me: { status: 200, body: { kind: "client", ns: "beta_ns", projects: ["proj-a"] } },
    });
    expect(codes(r, "error")).toEqual(["kh_ns_mismatch"]);
    expect(item(r, "kh_ns_mismatch")?.params).toEqual({ found: "beta_ns" });
    expect(codes(ev({ me: { status: 404, body: { error: "ns_not_active" } } }), "error")).toContain(
      "kh_ns_not_active",
    );
  });
  it("HUB-FR-131 · R39 · manifest_rev 0 ⇒ kh_manifest_missing; thiếu keyspace ⇒ kh_keyspace_missing {keyspace}; 423 ⇒ cảnh báo kh_ns_suspended", () => {
    expect(codes(ev({ manifest: manifest({ rev: 0 }) }), "error")).toContain("kh_manifest_missing");
    const ks = ev({ manifest: manifest({ ks: "other" }) });
    expect(codes(ks, "error")).toEqual(["kh_keyspace_missing"]);
    expect(item(ks, "kh_keyspace_missing")?.params).toEqual({ keyspace: "step" });
    const sus = ev({ manifest: { status: 423, body: { error: "ns_suspended" } } });
    expect(codes(sus, "warning")).toContain("kh_ns_suspended");
    expect(codes(sus, "error")).toEqual([]);
  });
  it("HUB-BR-40 · Q2 · K1-AC01 · R40 · lanes bật + tenant có project dùng chung ⇒ kh_people_lanes_on_shared {project_id}; chỉ project riêng ⇒ ok", () => {
    const shared = ev({
      manifest: manifest({ lanes: null }),
      sharedProjects: ["proj-s"],
      declaredProjects: ["proj-a", "proj-s"],
    });
    expect(shared.status).toBe("error");
    expect(codes(shared, "error")).toEqual(["kh_people_lanes_on_shared"]);
    expect(item(shared, "kh_people_lanes_on_shared")?.params).toEqual({ project_id: "proj-s" });
    const priv = ev({ manifest: manifest({ lanes: true }), sharedProjects: [] });
    expect(priv.status).toBe("ok");
    expect(codes(priv, "error")).toEqual([]);
    const offShared = ev({
      manifest: manifest({ lanes: false }),
      sharedProjects: ["proj-s"],
      declaredProjects: ["proj-a", "proj-s"],
    });
    expect(codes(offShared, "error")).toEqual([]);
  });
  it("HUB-BR-35 · R41 · project khai báo không có trong me.projects ⇒ kh_project_not_attached {project_id}; me.projects [] ⇒ cảnh báo kh_projects_unverified", () => {
    const r = ev({ declaredProjects: ["proj-a", "proj-x"] });
    expect(codes(r, "error")).toEqual(["kh_project_not_attached"]);
    expect(item(r, "kh_project_not_attached")?.params).toEqual({ project_id: "proj-x" });
    const u = ev({ me: { status: 200, body: { kind: "client", ns: "acme_ns", projects: [] } } });
    expect(u.status).toBe("ok");
    expect(codes(u, "warning")).toContain("kh_projects_unverified");
  });
  it("HUB-FR-131 · R42 · status = error ⇔ có mục level=error; items ≤ 30; mục lỗi đứng trước theo thứ tự bước (version trước manifest)", () => {
    const r = ev({ version: "v6.0", manifest: manifest({ rev: 0 }) });
    expect(r.status).toBe("error");
    const e = codes(r, "error");
    expect(e.indexOf("kh_version_too_old")).toBeLessThan(e.indexOf("kh_manifest_missing"));
    expect(r.items.length).toBeLessThanOrEqual(30);
  });
});

describe("R43 · khCheckShouldContinue [plan §2.2]", () => {
  it("HUB-FR-131 · R43 · dừng sau lỗi url / health / credentials / token; đi tiếp khi các bước đó đạt", () => {
    const c = fn(m, "khCheckShouldContinue");
    expect(c({ url: { ok: false } })).toBe(false);
    expect(c({ url: { ok: true, localDev: false }, health: 503 })).toBe(false);
    expect(c({ url: { ok: true, localDev: false }, health: "timeout" })).toBe(false);
    expect(c({ url: { ok: true, localDev: false }, health: 200 })).toBe(true);
    expect(
      c({
        url: { ok: true, localDev: false },
        health: 200,
        version: "v6.4",
        meNoToken: 401,
        credentials: "invalid",
      }),
    ).toBe(false);
    expect(
      c({ url: { ok: true, localDev: false }, health: 200, credentials: "ok", token: 401 }),
    ).toBe(false);
    expect(
      c({ url: { ok: true, localDev: false }, health: 200, credentials: "ok", token: 200 }),
    ).toBe(true);
  });
});
