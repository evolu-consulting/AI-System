// trello-config-ui · truy vấn admin.trello_config (một hàng, RLS chỉ scope platform). Mỗi hàm một câu SQL cố định.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { TrelloRowMeta } from "./trello-config.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

export type TrelloRow = TrelloRowMeta & {
  apiKeyCt: Uint8Array;
  apiKeyIv: Uint8Array;
  tokenCt: Uint8Array;
  tokenIv: Uint8Array;
  keyVersion: number;
};

type Raw = {
  api_key_ct: Uint8Array;
  api_key_iv: Uint8Array;
  api_key_last4: string;
  token_ct: Uint8Array;
  token_iv: Uint8Array;
  token_last4: string;
  key_version: number;
  list_id: string;
  updated_at: Date | string;
};

/** `forUpdate` khi sắp ghi (giữ nguyên trường không đổi trong cùng tx). */
export async function findTrello(tx: Tx, forUpdate = false): Promise<TrelloRow | null> {
  const [r] = await run<Raw>(
    tx,
    sql`select api_key_ct, api_key_iv, api_key_last4, token_ct, token_iv, token_last4, key_version, list_id, updated_at
      from admin.trello_config where id = 1 ${forUpdate ? sql`for update` : sql``}`,
  );
  if (!r) return null;
  return {
    apiKeyCt: r.api_key_ct,
    apiKeyIv: r.api_key_iv,
    apiKeyLast4: r.api_key_last4,
    tokenCt: r.token_ct,
    tokenIv: r.token_iv,
    tokenLast4: r.token_last4,
    keyVersion: r.key_version,
    listId: r.list_id,
    updatedAt: new Date(r.updated_at),
  };
}

export type TrelloWrite = Omit<TrelloRow, "updatedAt"> & { actorId: string };

export async function upsertTrello(tx: Tx, w: TrelloWrite): Promise<void> {
  const b = (u: Uint8Array) => Buffer.from(u);
  await tx.execute(sql`insert into admin.trello_config as t
      (id, api_key_ct, api_key_iv, api_key_last4, token_ct, token_iv, token_last4, key_version, list_id, updated_at, updated_by)
    values (1, ${b(w.apiKeyCt)}, ${b(w.apiKeyIv)}, ${w.apiKeyLast4}, ${b(w.tokenCt)}, ${b(w.tokenIv)}, ${w.tokenLast4},
      ${w.keyVersion}, ${w.listId}, now(), ${w.actorId})
    on conflict (id) do update set api_key_ct = excluded.api_key_ct, api_key_iv = excluded.api_key_iv,
      api_key_last4 = excluded.api_key_last4, token_ct = excluded.token_ct, token_iv = excluded.token_iv,
      token_last4 = excluded.token_last4, key_version = excluded.key_version, list_id = excluded.list_id,
      updated_at = now(), updated_by = excluded.updated_by`);
}

export async function deleteTrello(tx: Tx): Promise<boolean> {
  const rows = await run<{ id: number }>(
    tx,
    sql`delete from admin.trello_config where id = 1 returning id`,
  );
  return rows.length > 0;
}
