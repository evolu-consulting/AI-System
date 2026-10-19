// HD-FR-07 · HD-AC01 · PK-FR-06: link tệp HĐ — không thấy / org lệch ⇒ null và KHÔNG gọi FileBox; có ⇒ đúng org tenant token.
import { describe, expect, it } from "bun:test";
import { getFileLink } from "./get-file-link.usecase";
import type { ContractFileRef } from "./ports";

const A = "a0000000-0000-4000-8000-000000000001";
const who = { tenantId: A, userId: "u" };

function setup(ref: ContractFileRef | null, opts: { noClient?: boolean } = {}) {
  const calls: [string, string][] = [];
  const warns: unknown[] = [];
  const uow = {
    tenant: <T>(_w: unknown, fn: (r: never) => Promise<T>) =>
      fn({ contracts: { fileOf: async () => ref } } as never),
  };
  const link = opts.noClient
    ? null
    : async (org: string, fileId: string) => {
        calls.push([org, fileId]);
        return `http://fb/d/${fileId}-tok`;
      };
  const run = getFileLink({
    packKey: "contracts",
    uow,
    link,
    log: { warn: (m, f) => warns.push([m, f]) },
  });
  return { run, calls, warns };
}

describe("getFileLink", () => {
  it("HĐ có tệp của tenant ⇒ URL, gọi FileBox đúng org một lần", async () => {
    const s = setup({ org: `t_${A}`, fileId: "fb-1" });
    expect(await s.run(who, "id")).toBe("http://fb/d/fb-1-tok");
    expect(s.calls).toEqual([[`t_${A}`, "fb-1"]]);
  });
  it("không thấy (id lạ / tenant khác / không tệp) ⇒ null, FileBox không bị gọi", async () => {
    const s = setup(null);
    expect(await s.run(who, "id")).toBeNull();
    expect(s.calls).toEqual([]);
  });
  it("org lệch tenant token ⇒ null + log (không file_id), FileBox không bị gọi", async () => {
    const s = setup({ org: "t_khac", fileId: "fb-1" });
    expect(await s.run(who, "cid")).toBeNull();
    expect(s.calls).toEqual([]);
    expect(s.warns).toEqual([
      ["pack-file-org-mismatch", { pack: "contracts", contract_id: "cid" }],
    ]);
  });
  it("FileBox chưa cấu hình: không thấy ⇒ null; có tệp ⇒ ném (fail-closed)", async () => {
    expect(await setup(null, { noClient: true }).run(who, "id")).toBeNull();
    await expect(
      setup({ org: `t_${A}`, fileId: "fb-1" }, { noClient: true }).run(who, "id"),
    ).rejects.toThrow();
  });
});
