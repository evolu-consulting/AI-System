// CR-118 · cr118-r1-fixes #3 · trigger brand công ty (pack-contracts 0073): đổi brand ⇒ `profile_version` +1 + NOTIFY
// `profile_changed` (entity tenant, tenant_id) cùng transaction; `config_version` toàn cục giữ nguyên; cột khác ⇒ không bump.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PROFILE_CHANNEL, ProfileChangedPayloadSchema } from "@ai/contracts";
import { tenants } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";

let o: Sql;
let A = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(3);
  [A] = (await tenants(o, 1, 893)) as [string];
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

const versions = async () => {
  const [r] = await o<{ c: number; p: string }[]>`
    select config_version as c, profile_version::text as p from admin.config_meta where id = 1`;
  return { config: r?.c ?? -1, profile: Number(r?.p ?? -1) };
};

describe("CR-118 · cr118-r1-fixes · brand bump profile_version", () => {
  it("đổi brand bump profile_version, không bump config_version", async () => {
    const got: string[] = [];
    let notified: () => void = () => {};
    const arrived = new Promise<void>((r) => {
      notified = r;
    });
    const sub = await o.listen(PROFILE_CHANNEL, (p) => {
      got.push(p);
      notified();
    });
    try {
      const v0 = await versions();
      await o`insert into contracts.company_settings (tenant_id, company_name, app_name)
        values (${A}, 'R1 Co', 'R1 App') on conflict (tenant_id) do update
        set company_name = excluded.company_name, app_name = excluded.app_name`;
      await arrived;
      const v1 = await versions();
      const p = ProfileChangedPayloadSchema.parse(JSON.parse(got[0] ?? "null"));
      expect({
        config: v1.config - v0.config,
        profile: v1.profile - v0.profile,
        p: { entity: p.entity, tenant: p.tenant_id, v: p.v },
      }).toEqual({ config: 0, profile: 1, p: { entity: "tenant", tenant: A, v: v1.profile } });
    } finally {
      await sub.unlisten();
    }
  });
});
