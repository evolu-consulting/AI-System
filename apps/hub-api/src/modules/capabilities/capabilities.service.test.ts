// CR-118 · cr118-config-consistency · brand của `/pack/me` không TTL: nhớ tới khi ConfigCache báo tenant bị chạm (đổi brand bump
// `config_version` kèm `tenant_id`); tenant khác giữ bản nhớ; `null` (không rõ tenant) ⇒ bỏ hết. `home` theo default_app.
import { describe, expect, it } from "bun:test";
import type { ConfigCache } from "../config/config.service";
import { CapabilitiesService, type CapsView } from "./capabilities.service";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b1";
type Change = { tenants: ReadonlySet<string> | null };

function setup(defaultApp: string | null = null) {
  const names: Record<string, string> = { [A]: "Acme", [B]: "Beta" };
  const calls: string[] = [];
  let listener: ((c: Change) => void) | null = null;
  const view = {
    adminSettled: async () => {},
    catalog: async () => ({ adminVersion: 1, features: [] }),
    snapshot: async () => ({ version: 1 }),
    user: async () => undefined,
    tenant: async (id: string) => ({ id, active: true, maxConcurrentSub: null, defaultApp }),
    versions: () => ({ admin: 1, hub: 1 }),
  } as unknown as CapsView;
  const svc = new CapabilitiesService({
    view,
    loadExtras: async () => ({ slots: [], standalone: [] }),
    brand: async (tid) => {
      calls.push(tid);
      return { name: names[tid] ?? null, appName: null, logo: null, accent: null };
    },
    onChange: (fn) => {
      listener = fn;
      return () => {
        listener = null;
      };
    },
  });
  const me = async (tid: string) =>
    JSON.parse(
      (await svc.shellMe({ userId: `${tid.slice(0, -2)}ff`, tenantId: tid, role: "member" })).body,
    );
  const fire = (tenants: ReadonlySet<string> | null) => listener?.({ tenants });
  return { svc, me, calls, names, fire };
}

describe("CR-118 · config-consistency · brand theo onChange (không TTL)", () => {
  it("nóng: không đọc lại, tenant bị chạm ⇒ đọc lại đúng tenant đó, null ⇒ đọc lại mọi tenant", async () => {
    const s = setup();
    await s.me(A);
    await s.me(B);
    await s.me(A);
    expect(s.calls).toEqual([A, B]);
    s.names[A] = "Acme 2";
    s.fire(new Set([A]));
    expect((await s.me(A)).brand.name).toBe("Acme 2");
    await s.me(B);
    expect(s.calls).toEqual([A, B, A]);
    s.fire(null);
    await s.me(B);
    expect(s.calls).toEqual([A, B, A, B]);
    s.svc.close();
  });

  it("home = default_app của công ty khi không có gói nào đọc được ⇒ null (không mở app không có quyền)", async () => {
    const s = setup("contracts");
    expect((await s.me(A)).home).toBeNull();
  });
});

// giữ kiểu ConfigCache.onChange khớp deps (lỗi kiểu ở đây = mount không truyền được)
export type _OnChangeFits = Parameters<ConfigCache["onChange"]>[0] extends (c: Change) => void
  ? true
  : never;
