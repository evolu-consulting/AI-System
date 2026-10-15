// HUB-FR-138 · HUB-FR-139 · FB1-AC-15 · hạ tầng cho ca "đường ghi output/diff/log/nháp dưới driver filebox" (reviewer Blocker):
// đọc lại một attachment qua route người dùng (nhánh inline `Sec-Fetch-Mode: cors`) và đối chiếu hàng DB ↔ FileBox giả.
// Không chứa `it(...)`.
import { expect } from "bun:test";
import { createHash } from "node:crypto";
import type { Json, Sql } from "../H1/_fixtures";
import type { FbFake } from "./_fbfake";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/**
 * Hàng `hub.attachments` `id` có `filebox_file_id`/`version_id` ≠ NULL, file có thật ở FileBox, `GET /content` (inline) = 200 với đúng
 * byte đang lưu ở FileBox (sha256/size khớp cột) — KHÔNG 404.
 */
export async function expectFbReadable(
  o: { sql: Sql; fake: FbFake; base: string; token: string },
  id: string | null | undefined,
  label: string,
): Promise<Json> {
  expect({ label, id: typeof id }).toEqual({ label, id: "string" });
  const [r] = await o.sql<
    { j: Json }[]
  >`select to_jsonb(a) as j from hub.attachments a where a.id = ${id as string}`;
  const row = r?.j;
  expect({ label, row: !!row }).toEqual({ label, row: true });
  expect({ label, file: typeof row.filebox_file_id, ver: typeof row.filebox_version_id }).toEqual({
    label,
    file: "string",
    ver: "string",
  });
  expect({ label, inFileBox: o.fake.has(row.filebox_file_id) }).toEqual({ label, inFileBox: true });
  const res = await fetch(`${o.base}/attachments/${id}/content`, {
    headers: { authorization: `Bearer ${o.token}`, "sec-fetch-mode": "cors" },
    redirect: "manual",
    keepalive: false,
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect({ label, status: res.status }).toEqual({ label, status: 200 });
  expect({ label, sha: sha(bytes), size: bytes.length }).toEqual({
    label,
    sha: row.sha256,
    size: Number(row.size),
  });
  expect(Buffer.from(bytes).equals(Buffer.from(o.fake.bytesOf(row.filebox_file_id) ?? []))).toBe(
    true,
  );
  return row;
}

/** Không hàng output nào thiếu `filebox_file_id`; mọi file MỚI ở FileBox (không có trong `before`) đều có hàng DB trỏ tới (không mồ côi). */
export async function expectNoFbGaps(sql: Sql, fake: FbFake, before: Set<string>): Promise<void> {
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.attachments
    where origin = 'output' and filebox_file_id is null`;
  expect({ outputRowsWithoutFileId: n?.n }).toEqual({ outputRowsWithoutFileId: 0 });
  const refs = new Set(
    (
      await sql<
        { f: string }[]
      >`select filebox_file_id as f from hub.attachments where filebox_file_id is not null`
    ).map((r) => r.f),
  );
  const orphans = fake.ids().filter((i) => !before.has(i) && !refs.has(i));
  expect({ orphansOnFileBox: orphans }).toEqual({ orphansOnFileBox: [] });
}
