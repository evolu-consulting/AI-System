// HUB-FR-44 · H2c-R06 · HUB-H2c-AC-14 · test-plan-int §2.2 A20–A24: hạn mức dung lượng theo tenant (ngưỡng 1 MiB qua
// `AppDeps.attachments.tenantMaxBytes` — L2): song song đúng 2/3 (chốt dưới khoá advisory tenant), kiểm sớm theo
// `Content-Length` trước khi đọc thân, chốt sau stream khi chunked, tách tenant, `purged_at` không tính, tính cả output.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { type Keys, makeKeys, type Sql, sign, T, USERS } from "../H1/_fixtures";
import {
  codeOf,
  diskFiles,
  type HubC,
  insertAttachmentRow,
  KiB,
  parts,
  pct,
  rawUpload,
  rmDir,
  sample,
  setupH2c,
  startHubH2c,
  upload,
} from "./_h2c";

let sql: Sql;
let k: Keys;
let hub: HubC;
let lan = "";
let an = "";

beforeAll(async () => {
  sql = await setupH2c();
  k = await makeKeys();
  hub = await startHubH2c(k, { tenantMaxBytes: 1024 * KiB });
  lan = await sign(k, USERS.lan);
  an = await sign(k, USERS.an);
}, 60_000);
/** Mỗi ca bắt đầu từ dung lượng 0 của mọi tenant (hàng + file). */
beforeEach(async () => {
  await sql`delete from hub.attachments`;
  for (const t of [T.acme, T.beta]) await rmDir(join(hub.dir, t));
});
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

const tenantRows = async (tenant: string) => {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments
    where tenant_id = ${tenant}`;
  return r?.n ?? -1;
};
const quotaErr = { status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" };

describe("A20–A24 · hạn mức tenant [H2c-R06 · HUB-H2c-AC-14]", () => {
  it("HUB-FR-44 · A20 · tenantMaxBytes 1 MiB: 3 upload 400 KiB song song (Content-Length) → đúng 2 × 201, 1 × 409; 2 hàng, 2 file, 0 .part; 5 vòng [AC-14 · Q-T2]", async () => {
    for (let round = 0; round < 5; round++) {
      await sql`delete from hub.attachments`;
      await rmDir(join(hub.dir, T.acme));
      const rs = await Promise.all(
        [0, 1, 2].map((i) => upload(hub, lan, sample.pdf(400 * KiB), `r${round}-${i}.pdf`)),
      );
      const st = rs.map((r) => r.status).sort();
      expect({ round, st }).toEqual({ round, st: [201, 201, 409] });
      expect(
        codeOf(rs.find((r) => r.status === 409) ?? rs[0] ?? { status: 0, json: null }),
      ).toEqual(quotaErr);
      expect(await tenantRows(T.acme)).toBe(2);
      const files = await diskFiles(hub.dir);
      expect({ files: files.length, parts: parts(files) }).toEqual({ files: 2, parts: [] });
    }
  });

  it("HUB-FR-44 · A21 · kiểm sớm: đã dùng 900 KiB, Content-Length 200 KiB (gửi chậm) → 409 trước khi đọc hết thân, 0 .part [H2c-R06 · P6]", async () => {
    await insertAttachmentRow(sql, { who: "lan", size: 900 * KiB });
    const r = await rawUpload(
      hub.port,
      {
        Authorization: `Bearer ${lan}`,
        "X-Filename": pct("som.pdf"),
        "Content-Length": String(200 * KiB),
      },
      {
        total: 200 * KiB,
        chunk: 16 * KiB,
        everyMs: 50,
        prefix: new TextEncoder().encode("%PDF-1.4\n"),
      },
    );
    expect(r.status).toBe(409);
    expect(r.sentAtResponse).toBeLessThan(200 * KiB);
    expect(parts(await diskFiles(hub.dir))).toEqual([]);
    expect(await tenantRows(T.acme)).toBe(1);
  });

  it("HUB-FR-44 · A22 · chốt dưới khoá: chunked 200 KiB khi đã dùng 900 KiB → stream xong rồi 409, .part xoá, 0 hàng mới [H2c-R06 · R05]", async () => {
    await insertAttachmentRow(sql, { who: "lan", size: 900 * KiB });
    const r = await upload(hub, lan, sample.pdf(200 * KiB), "chot.pdf", { chunked: true });
    expect(codeOf(r)).toEqual(quotaErr);
    expect(await diskFiles(hub.dir)).toEqual([]);
    expect(await tenantRows(T.acme)).toBe(1);
  });

  it("HUB-FR-44 · A23 · theo tenant: acme đầy 1 MiB không ảnh hưởng beta (an → 201); hàng acme purged_at không tính (lan → 201) [H2c-R06]", async () => {
    const full = await insertAttachmentRow(sql, { who: "lan", size: 1024 * KiB });
    expect(codeOf(await upload(hub, lan, sample.pdf(400 * KiB), "day.pdf"))).toEqual(quotaErr);
    const beta = await upload(hub, an, sample.pdf(400 * KiB), "beta.pdf");
    expect(beta.status).toBe(201);
    await sql`update hub.attachments set purged_at = now() where id = ${full.id}`;
    const again = await upload(hub, lan, sample.pdf(400 * KiB), "lai.pdf");
    expect(again.status).toBe(201);
  });

  it("HUB-FR-44 · A24 · dung lượng tính cả origin='output' (hàng output 900 KiB, chèn SQL) → upload 200 KiB → 409 [H2c-R06]", async () => {
    await insertAttachmentRow(sql, { who: "lan", origin: "output", size: 900 * KiB });
    const r = await upload(hub, lan, sample.pdf(200 * KiB), "sau-output.pdf");
    expect(codeOf(r)).toEqual(quotaErr);
    expect(await tenantRows(T.acme)).toBe(1);
  });
});
