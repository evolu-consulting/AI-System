// CR-102 · com-c3 · PK-NFR-04: chặn đọc/ghi chéo tenant cho MỌI bảng mới của gói `community` (bộ hợp đồng `defineRlsSuite`).
// Chạy dưới role `community_rw` không `app.user_id` (việc nền) — lớp tenant độc lập với lớp người xem (visibility.rls.int.test).
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { defineRlsSuite } from "@ai/test-kit/rls-suite";

const tenants = { a: tenantId(951), b: tenantId(952) };
const who = userId(951);
/** Bài cha theo tenant (điền lúc seed). */
const post = new Map<string, string>();
const rnd = (pk?: string) => pk ?? crypto.randomUUID();

const one = async (sql: Sql, text: string, params: unknown[]): Promise<string> => {
  const rows = (await sql.unsafe(text, params as never[])) as unknown as { id: string }[];
  return rows[0]?.id as string;
};
const insPost = (tx: Sql, t: string, pk?: string) =>
  tx.unsafe(
    `insert into community.posts (id, tenant_id, type, author_user_id, aud_mode) values ($1, $2, 'note', $3, 'all') returning id::text as id`,
    [rnd(pk), t, who],
  );

defineRlsSuite({
  key: "community",
  tenants,
  ignoreTables: ["files", "index_outbox"],
  open: async () => {
    await cloneDb("full");
    return openOwner(2);
  },
  close: async (o) => {
    await o.end({ timeout: 2 });
  },
  reset: async (o) => {
    await o`insert into admin.tenants (id, key, name) values (${tenants.a}, 't951', 'T951'), (${tenants.b}, 't952', 'T952')
      on conflict do nothing`;
  },
  tables: [
    {
      name: "posts",
      seed: async (o, t) => {
        const id = await one(
          o,
          "insert into community.posts (tenant_id, type, author_user_id, aud_mode) values ($1, 'note', $2, 'all') returning id::text as id",
          [t, who],
        );
        post.set(t, id);
        return id;
      },
      insert: (tx, t, pk) => insPost(tx, t, pk),
    },
    {
      name: "post_items",
      seed: (o, t) =>
        one(
          o,
          "insert into community.post_items (tenant_id, post_id, product) values ($1, $2, 'SP') returning id::text as id",
          [t, post.get(t)],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into community.post_items (id, tenant_id, post_id, product) values ($1, $2, $3, 'SP')",
          [rnd(pk), t, post.get(t) as string],
        ),
    },
    {
      name: "quote_saves",
      seed: (o, t) =>
        one(
          o,
          "insert into community.quote_saves (tenant_id, post_id, saved_by, price) values ($1, $2, gen_random_uuid(), 1000) returning id::text as id",
          [t, post.get(t)],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into community.quote_saves (id, tenant_id, post_id, saved_by, price, item_idx) values ($1, $2, $3, gen_random_uuid(), 1000, 7)",
          [rnd(pk), t, post.get(t) as string],
        ),
    },
    {
      name: "media",
      seed: (o, t) =>
        one(
          o,
          "insert into community.media (tenant_id, post_id, kind) values ($1, $2, 'image') returning id::text as id",
          [t, post.get(t)],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          "insert into community.media (id, tenant_id, post_id, kind) values ($1, $2, $3, 'image')",
          [rnd(pk), t, post.get(t) as string],
        ),
    },
    {
      name: "comments",
      seed: (o, t) =>
        one(
          o,
          `insert into community.comments (tenant_id, post_id, author_user_id, text_raw, text_masked)
           values ($1, $2, $3, 'x', 'x') returning id::text as id`,
          [t, post.get(t), who],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          `insert into community.comments (id, tenant_id, post_id, author_user_id, text_raw, text_masked)
           values ($1, $2, $3, $4, 'x', 'x')`,
          [rnd(pk), t, post.get(t) as string, who],
        ),
    },
    {
      name: "settings",
      pk: "user_id",
      seed: (o, t) =>
        one(
          o,
          "insert into community.settings (tenant_id, user_id) values ($1, $2) returning user_id::text as id",
          [t, crypto.randomUUID()],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe("insert into community.settings (tenant_id, user_id) values ($1, $2)", [
          t,
          rnd(pk),
        ]),
    },
    {
      name: "join_requests",
      seed: (o, t) =>
        one(
          o,
          `insert into community.join_requests (tenant_id, requester_user_id, requester_org, company, contact, email)
           values ($1, $2, $3, 'C', 'C', 'c@c.test') returning id::text as id`,
          [t, who, crypto.randomUUID()],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          `insert into community.join_requests (id, tenant_id, requester_user_id, requester_org, company, contact, email)
           values ($1, $2, $3, $4, 'C', 'C', 'c@c.test')`,
          [rnd(pk), t, who, crypto.randomUUID()],
        ),
    },
    {
      name: "reports",
      seed: (o, t) =>
        one(
          o,
          `insert into community.reports (tenant_id, post_id, reporter_user_id, reason)
           values ($1, $2, $3, 'r') returning id::text as id`,
          [t, post.get(t), who],
        ),
      insert: (tx, t, pk) =>
        tx.unsafe(
          `insert into community.reports (id, tenant_id, post_id, reporter_user_id, reason) values ($1, $2, $3, $4, 'r')`,
          [rnd(pk), t, post.get(t) as string, crypto.randomUUID()],
        ),
    },
  ],
});
