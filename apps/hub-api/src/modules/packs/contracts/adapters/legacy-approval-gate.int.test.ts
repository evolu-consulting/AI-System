// CR-127 · Z1 · BR-78 · spec §5.8: chốt chặn của MIGC 0099 — chạy LẠI đúng đoạn chốt chặn trên dữ liệu dựng trong tx (rollback cuối ca):
// còn lượt máy cũ mở / HĐ chốt còn lượt mở / HĐ processing mất lượt ⇒ RAISE; dữ liệu sạch (lượt engine, lượt đọc đang chạy) ⇒ qua.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";

const MIG = join(
  import.meta.dir,
  "../../../../../../../packages/db/migrations-pack-contracts/0099_drop_legacy_approval.sql",
);
const gateStatements = (): string[] => {
  const src = readFileSync(MIG, "utf8");
  const a = src.indexOf("-- >>> Z1 CHOT CHAN");
  const b = src.indexOf("-- <<< Z1 CHOT CHAN");
  if (a < 0 || b < 0) throw new Error("thiếu mốc chốt chặn trong 0099");
  return src
    .slice(a, b)
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, "").trim().length > 0);
};

let o: Sql;
let T = "";
let U = "";
const ROLLBACK = new Error("rollback");
type Mk = (status: string, extra?: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 9199)) as [string];
  [U] = (await users(o, T, 1, { from: 9199 })) as [string];
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

/** Dựng dữ liệu trong tx, chạy chốt chặn, trả lỗi (hoặc null) rồi rollback. */
async function gate(build: (tx: Sql, mk: Mk) => Promise<void>): Promise<string | null> {
  let err: string | null = null;
  await o
    .begin(async (tx) => {
      const t = tx as unknown as Sql;
      const mk: Mk = async (status, extra = {}) => {
        const [r] = await t<{ id: string }[]>`insert into contracts.contracts ${t({
          tenant_id: T,
          title: "HĐ thử Z1",
          created_by: U,
          status,
          ...extra,
        } as never)} returning id`;
        return (r as { id: string }).id;
      };
      await build(t, mk);
      const run = async () => {
        for (const s of gateStatements()) await t.unsafe(s);
      };
      // Lỗi của câu chốt chặn làm tx "aborted" ⇒ chạy trong savepoint.
      await (t as unknown as { savepoint: (f: () => Promise<void>) => Promise<void> })
        .savepoint(run)
        .catch((e: Error) => {
          err = e.message;
        });
      throw ROLLBACK;
    })
    .catch((e) => {
      if (e !== ROLLBACK) throw e;
    });
  return err;
}

const appr = async (t: Sql, cid: string, status: string, mode: string) => {
  const [r] = await t<
    { id: string }[]
  >`insert into contracts.approvals (tenant_id, contract_id, status, started_by, mode)
    values (${T}, ${cid}, ${status}, ${U}, ${mode}) returning id`;
  return (r as { id: string }).id;
};

describe("CR-127 Z1 · chốt chặn 0099 (BR-78)", () => {
  it("dữ liệu sạch (lượt engine đang mở + lượt đọc đang chạy + HĐ done) ⇒ qua", async () => {
    expect(
      await gate(async (t, mk) => {
        const p = await mk("processing");
        await t`update contracts.contracts set run_id = ${await appr(t, p, "level1", "engine")} where id = ${p}`;
        const d = await mk("draft", { extract_state: "reading" });
        await t`update contracts.contracts set run_id = ${await appr(t, d, "extracting", "machine")} where id = ${d}`;
        await mk("done");
      }),
    ).toBeNull();
  });

  it("còn lượt máy cũ ở cấp 1/2 ⇒ RAISE", async () => {
    const e = await gate(async (t, mk) => {
      await appr(t, await mk("draft"), "level2", "machine");
    });
    expect(e).toContain("lượt duyệt máy cũ");
  });

  it("lượt đọc `extracting` mồ côi (HĐ không còn đang đọc) ⇒ RAISE", async () => {
    const e = await gate(async (t, mk) => {
      await appr(t, await mk("draft", { extract_state: "ready" }), "extracting", "machine");
    });
    expect(e).toContain("lượt duyệt máy cũ");
  });

  it("HĐ done/reject còn trỏ lượt đang mở ⇒ RAISE", async () => {
    const e = await gate(async (t, mk) => {
      const c = await mk("done");
      await t`update contracts.contracts set run_id = ${await appr(t, c, "level1", "engine")} where id = ${c}`;
    });
    expect(e).toContain("done/reject còn lượt duyệt đang mở");
  });

  it("HĐ processing không có lượt đang mở ⇒ RAISE", async () => {
    const e = await gate(async (_t, mk) => {
      await mk("processing");
    });
    expect(e).toContain("processing không có lượt duyệt đang mở");
  });
});
