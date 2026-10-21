// feedback · truy vấn admin.feedback / feedback_files (RLS admin_rw: xem migration 0017). Mỗi hàm một câu SQL cố định.
import type { FeedbackItem, FeedbackListQuery, FeedbackStatus } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { DecodedFile } from "./feedback.rules";

const run = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)) as unknown as T[];

type Raw = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  user_id: string;
  user_name: string;
  app: string;
  kind: FeedbackItem["kind"];
  message: string;
  page_url: string;
  app_version: string;
  status: FeedbackStatus;
  reply: string | null;
  replied_at: Date | string | null;
  created_at: Date | string;
  files: { id: string; name: string; mime: string; size_bytes: number | string }[];
  total: number | string;
};

const iso = (d: Date | string): string => new Date(d).toISOString();

const SELECT = sql`select f.id, f.tenant_id, coalesce(t.name, '') as tenant_name, f.user_id,
    coalesce(u.display_name, '') as user_name, f.app, f.kind, f.message, f.page_url, f.app_version, f.status,
    f.reply, f.replied_at, f.created_at,
    coalesce((select json_agg(json_build_object('id', x.id, 'name', x.name, 'mime', x.mime, 'size_bytes', x.size_bytes)
      order by x.created_at, x.id) from admin.feedback_files x where x.feedback_id = f.id), '[]'::json) as files,
    count(*) over() as total
  from admin.feedback f
  left join admin.tenants t on t.id = f.tenant_id
  left join admin.users u on u.id = f.user_id and u.tenant_id = f.tenant_id`;

function toItem(r: Raw): FeedbackItem {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    tenant_name: r.tenant_name,
    user_id: r.user_id,
    user_name: r.user_name,
    app: r.app,
    kind: r.kind,
    message: r.message,
    page_url: r.page_url,
    app_version: r.app_version,
    status: r.status,
    reply: r.reply,
    replied_at: r.replied_at ? iso(r.replied_at) : null,
    created_at: iso(r.created_at),
    files: r.files.map((x) => ({ ...x, size_bytes: Number(x.size_bytes) })),
  };
}

export async function insertFeedback(
  tx: Tx,
  b: {
    tenantId: string;
    userId: string;
    app: string;
    kind: string;
    message: string;
    pageUrl: string;
    appVersion: string;
  },
  files: DecodedFile[],
): Promise<string> {
  const [row] = await run<{ id: string }>(
    tx,
    sql`insert into admin.feedback (tenant_id, user_id, app, kind, message, page_url, app_version)
      values (${b.tenantId}::uuid, ${b.userId}::uuid, ${b.app}, ${b.kind}, ${b.message}, ${b.pageUrl}, ${b.appVersion})
      returning id`,
  );
  const id = row?.id ?? "";
  for (const f of files) {
    await tx.execute(
      sql`insert into admin.feedback_files (feedback_id, tenant_id, name, mime, size_bytes, data)
        values (${id}::uuid, ${b.tenantId}::uuid, ${f.name}, ${f.mime}, ${f.bytes.length},
          decode(${f.bytes.toString("base64")}, 'base64'))`,
    );
  }
  return id;
}

/** Góp ý của chính `userId` (mới nhất trước). */
export async function listMine(tx: Tx, userId: string, limit: number): Promise<FeedbackItem[]> {
  const rows = await run<Raw>(
    tx,
    sql`${SELECT} where f.user_id = ${userId}::uuid order by f.created_at desc, f.id limit ${limit}`,
  );
  return rows.map(toItem);
}

export async function listAdmin(
  tx: Tx,
  q: Required<Pick<FeedbackListQuery, "limit" | "offset">> & FeedbackListQuery,
): Promise<{ items: FeedbackItem[]; total: number }> {
  const rows = await run<Raw>(
    tx,
    sql`${SELECT}
      where (${q.tenant_id ?? null}::uuid is null or f.tenant_id = ${q.tenant_id ?? null}::uuid)
        and (${q.app ?? null}::text is null or f.app = ${q.app ?? null}::text)
        and (${q.kind ?? null}::text is null or f.kind = ${q.kind ?? null}::text)
        and (${q.status ?? null}::text is null or f.status = ${q.status ?? null}::text)
      order by f.created_at desc, f.id limit ${q.limit} offset ${q.offset}`,
  );
  return { items: rows.map(toItem), total: rows[0] ? Number(rows[0].total) : 0 };
}

export async function findOne(tx: Tx, id: string): Promise<FeedbackItem | null> {
  const rows = await run<Raw>(tx, sql`${SELECT} where f.id = ${id}::uuid`);
  return rows[0] ? toItem(rows[0]) : null;
}

/** Cập nhật trạng thái và/hoặc phản hồi; trả `false` nếu RLS/id không cho thấy hàng. */
export async function updateFeedback(
  tx: Tx,
  id: string,
  b: { status?: FeedbackStatus; reply?: string },
  actorId: string,
): Promise<boolean> {
  const rows = await run<{ id: string }>(
    tx,
    sql`update admin.feedback set
        status = coalesce(${b.status ?? null}::text, status),
        reply = coalesce(${b.reply ?? null}::text, reply),
        replied_at = case when ${b.reply ?? null}::text is null then replied_at else now() end,
        replied_by = case when ${b.reply ?? null}::text is null then replied_by else ${actorId}::uuid end,
        updated_at = now()
      where id = ${id}::uuid returning id`,
  );
  return rows.length > 0;
}

export async function fileOf(
  tx: Tx,
  feedbackId: string,
  fileId: string,
): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
  const rows = await run<{ name: string; mime: string; b64: string }>(
    tx,
    sql`select name, mime, encode(data, 'base64') as b64 from admin.feedback_files
      where id = ${fileId}::uuid and feedback_id = ${feedbackId}::uuid`,
  );
  const r = rows[0];
  return r ? { name: r.name, mime: r.mime, bytes: Buffer.from(r.b64, "base64") } : null;
}
