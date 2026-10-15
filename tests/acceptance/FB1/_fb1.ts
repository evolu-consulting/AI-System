// HUB-FR-138 · HUB-FR-139 · HUB-FR-140 · HUB-FR-142 · hạ tầng int FB1 (spec §8): hub-api thật (dựng như `H2c/_h2c.ts startHubH2c`)
// nhưng kho đính kèm = driver FileBox (`createFileboxStorage`) trỏ vào FileBox GIẢ (`_fbfake.ts`, `FILEBOX_URL=http://127.0.0.1:<port>`).
//
// SEAM test ↔ driver (spec §8 "Cần làm rõ" C1 — backend-lead xác nhận/đổi): `storage.filebox.ts` xuất
//   `createFileboxStorage(cfg: {url; org; token: FileboxTokenSource; timeoutMs?; retryDelaysMs?: number[]; log?})`
//   với `FileboxTokenSource = {get(): Promise<string|null>; refresh(): Promise<string|null>}` (null = vắng secret ⇒ fail-closed).
//   `retryDelaysMs` mặc định `[1000, 2000, 4000]` (§4.6); test truyền `[5, 10, 20]` để không chờ cố định.
// Module chưa có ⇒ nạp động (`tryLoad`): `storageError` ghi lại, ca đỏ ở `expect` (không đỏ ở `beforeAll`). Cột `filebox_*`
// (migration 0033) đọc qua `hasFbSchema` ⇒ ca đỏ ở `expect`, không `PostgresError`. Không chứa `it(...)`.
import { expect } from "bun:test";
import { join } from "node:path";
import type { AttachmentStorage } from "../../../apps/hub-api/src/modules/attachments/storage";
import type { Json, Keys, Sql } from "../H1/_fixtures";
import { sign, USERS, type UserKey } from "../H1/_fixtures";
import type { HubX } from "../H1/_hub";
import { type H2bExtra, startHubH2b } from "../H2b/_h2b";
import {
  type AttRow,
  DEFAULT_TENANT_MAX,
  type HubC,
  insertAttachmentRow,
  rmDir,
  tempDir,
} from "../H2c/_h2c";
import { type Loose, ROOT } from "../M1/_modules";
import { type FbFake, startFbFake } from "./_fbfake";

export { type FbFake, startFbFake };
export const FB_ORG = "ai-system";
export const FB_SECRET_NAME = "filebox";

export type FileboxTokenSource = {
  get(): Promise<string | null>;
  refresh(): Promise<string | null>;
};
/** Nguồn token giả đếm số lần `get`/`refresh` (không bao giờ log giá trị). */
export type FakeTokens = FileboxTokenSource & {
  gets: number;
  refreshes: number;
  setCurrent: (t: string | null) => void;
};
export function fakeTokens(initial: string | null, afterRefresh?: string | null): FakeTokens {
  let cur = initial;
  const t: FakeTokens = {
    gets: 0,
    refreshes: 0,
    setCurrent: (v) => {
      cur = v;
    },
    get: async () => {
      t.gets++;
      return cur;
    },
    refresh: async () => {
      t.refreshes++;
      if (afterRefresh !== undefined) cur = afterRefresh;
      return cur;
    },
  };
  return t;
}

export async function tryLoad(rel: string): Promise<Loose> {
  try {
    return await import(join(ROOT, rel));
  } catch {
    return {};
  }
}
export const loadFbDriver = () =>
  tryLoad("apps/hub-api/src/modules/attachments/storage.filebox.ts");
export const loadStorageRules = () => tryLoad("apps/hub-api/src/modules/attachments/storage.ts");

export type FbOpts = {
  fake: FbFake;
  tokens?: FileboxTokenSource;
  tenantMaxBytes?: number;
  retryDelaysMs?: number[];
  extra?: H2bExtra;
};
export type HubFb = HubC & { fake: FbFake; tokens: FileboxTokenSource };

/** Dựng driver FileBox (nạp động) → `{storage, error}`. */
export async function buildFbStorage(
  o: FbOpts,
): Promise<{ storage: AttachmentStorage | null; error: string | null }> {
  const m = await loadFbDriver();
  if (typeof m.createFileboxStorage !== "function")
    return { storage: null, error: "createFileboxStorage chưa có (storage.filebox.ts)" };
  const tokens = o.tokens ?? fakeTokens(o.fake.token);
  try {
    const storage = (await m.createFileboxStorage({
      url: o.fake.origin,
      org: FB_ORG,
      token: tokens,
      timeoutMs: 5_000,
      retryDelaysMs: o.retryDelaysMs ?? [5, 10, 20],
    })) as AttachmentStorage;
    return { storage, error: null };
  } catch (e) {
    return { storage: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** hub-api thật + `attachments.storage` = driver FileBox. `stop()` dừng hub, xoá thư mục tạm (chỉ để `fileJob` ghi local nếu cần). */
export async function startHubFb(k: Keys, o: FbOpts): Promise<HubFb> {
  const dir = await tempDir("fb1");
  const tokens = o.tokens ?? fakeTokens(o.fake.token);
  const { storage, error } = await buildFbStorage({ ...o, tokens });
  const attachments = storage
    ? {
        storage,
        tenantMaxBytes: o.tenantMaxBytes ?? DEFAULT_TENANT_MAX,
        sweepS: 600,
        sweep: false,
      }
    : undefined;
  const extra = { instanceId: "qc-hub-fb1", ...o.extra, attachments } as H2bExtra;
  const hub: HubX = await startHubH2b(k, extra);
  const stop = hub.stop;
  return {
    ...hub,
    dir,
    storage,
    storageError: error,
    port: Number(new URL(hub.base).port),
    fake: o.fake,
    tokens,
    stop: async () => {
      await stop();
      await rmDir(dir);
    },
  };
}

/** Đầu mỗi ca cần cột 0033: đỏ đúng lý do khi chưa có migration. */
export async function hasFbSchema(sql: Sql): Promise<boolean> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from information_schema.columns
    where table_schema = 'hub' and table_name = 'attachments'
      and column_name in ('filebox_file_id', 'filebox_version_id')`;
  return (r?.n ?? 0) === 2;
}
export async function needFb(sql: Sql, hub?: HubFb): Promise<void> {
  expect({ migration0033: await hasFbSchema(sql), driver: hub ? hub.storageError : null }).toEqual({
    migration0033: true,
    driver: null,
  });
}

/** Hàng attachment dạng jsonb (cột 0033 vắng ⇒ khoá vắng, không PostgresError). */
export async function fbRow(sql: Sql, id: string): Promise<Json | undefined> {
  const [r] = await sql<
    { j: Json }[]
  >`select to_jsonb(a) as j from hub.attachments a where a.id = ${id}`;
  return r?.j;
}
export async function rowCount(sql: Sql, id: string): Promise<number> {
  const [r] = await sql<
    { n: number }[]
  >`select count(*)::int as n from hub.attachments where id = ${id}`;
  return r?.n ?? -1;
}

/**
 * Hàng filebox "đã commit": nạp byte vào FileBox giả + chèn hàng (SQL owner) có `filebox_file_id/version_id`;
 * `storage_key` giữ `tenant/id` (spec §3.2). Gọi sau `needFb`.
 */
export async function insertFbRow(
  sql: Sql,
  fake: FbFake,
  content: Uint8Array,
  o: Omit<AttRow, "content" | "dir"> = {},
): Promise<{ id: string; fileId: string; versionId: string; key: string }> {
  const r = await insertAttachmentRow(sql, { ...o, content });
  const f = fake.put(content, r.id);
  await sql`update hub.attachments set filebox_file_id = ${f.file_id}, filebox_version_id = ${f.version_id}
    where id = ${r.id}`;
  return { id: r.id, fileId: f.file_id, versionId: f.version_id, key: r.key };
}

export const tokenOf = (k: Keys, who: UserKey) => sign(k, USERS[who]);
