// CR-097 K2 · UC-04: `GET /contracts/:id/versions/diff?a=&b=[&text=1]` (read) — so sánh trường pháp lý (+ điều khoản khi `text=1`, CR-127 K5)
// hai phiên bản cùng chuỗi. CR-127 K5 · BR-36a: `GET /contracts/:id/changes-since-last` (read) — "Đã đổi so với lần trước" của thẻ duyệt.
// Repo MỘT câu trong tx `PackUow` (role `contracts_rw`, RLS FORCE + luật thấy) + `tenant_id` tường minh. Không thấy / khác chuỗi ⇒ 404.
import { VersionDiffQuerySchema } from "@ai/contracts/pack-contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { appError } from "../../../../lib/errors";
import { parseWith } from "../../../../lib/http";
import {
  checkPackAccess,
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/public";
import type {
  ChangesRepo,
  ChangesSinceLastUsecase,
  SubmissionSnap,
} from "../application/changes-since-last.usecase";
import type {
  VersionDiffRepo,
  VersionDiffUsecase,
  VersionFieldsRow,
} from "../application/version-diff.usecase";

export function versionDiffRepo(tx: Tx, t: string): { versionDiff: VersionDiffRepo } {
  return {
    versionDiff: {
      pair: async (id, a, b, withText = false) =>
        tx.execute<VersionFieldsRow>(sql`select v.id::text, v.version_no, v.fields,
            case when ${withText}::boolean then v.source_text end as source_text
          from contracts.contracts v
          where v.tenant_id = ${t}::uuid and v.id in (${a}::uuid, ${b}::uuid)
            and v.root_id = (select k.root_id from contracts.contracts k where k.id = ${id}::uuid and k.tenant_id = ${t}::uuid)`),
    },
  };
}

type SnapRow = {
  round: number | null;
  fields: unknown;
  source_text: string | null;
  return_note: string | null;
  submitted_by: string | null;
  owner_user_id: string | null;
  deciders: string[] | null;
};
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);

/** Hai lần gửi gần nhất của HĐ (văn bản hiệu lực = lần gần nhất có lưu văn bản, vì hồ sơ chỉ lưu khi đổi). MỘT câu; HĐ không thấy ⇒ null. */
export function changesRepo(tx: Tx, t: string): { changes: ChangesRepo } {
  return {
    changes: {
      lastTwo: async (id) => {
        const rows =
          await tx.execute<SnapRow>(sql`select s.round, s.fields, s.source_text, s.return_note, c.submitted_by::text, c.owner_user_id::text,
            (select array_agg(distinct e.actor_user_id::text) from contracts.contract_events e
              where e.tenant_id = c.tenant_id and e.contract_id = c.id and e.type = 'stage_decided') as deciders
          from contracts.contracts c
          left join lateral (
            select x.round, x.fields, x.return_note,
              coalesce(x.source_text, (select p.source_text from contracts.contract_submissions p
                where p.tenant_id = x.tenant_id and p.contract_id = x.contract_id and p.round < x.round
                  and p.source_text is not null order by p.round desc limit 1)) as source_text
            from contracts.contract_submissions x
            where x.tenant_id = c.tenant_id and x.contract_id = c.id order by x.round desc limit 2) s on true
          where c.id = ${id}::uuid and c.tenant_id = ${t}::uuid
          order by s.round desc nulls last`);
        if (rows.length === 0) return null;
        const first = rows[0];
        const snaps: SubmissionSnap[] = rows.flatMap((r) =>
          r.round === null
            ? []
            : [
                {
                  round: Number(r.round),
                  fields: json(r.fields),
                  source_text: r.source_text,
                  return_note: r.return_note,
                },
              ],
        );
        return {
          snaps,
          audience: {
            submittedBy: first?.submitted_by ?? null,
            owner: first?.owner_user_id ?? null,
            deciders: first?.deciders ?? [],
          },
        };
      },
    },
  };
}

export function versionsRoutes(
  view: PackAccessView,
  diff: VersionDiffUsecase,
  changes: ChangesSinceLastUsecase,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  r.get("/contracts/:id/versions/diff", packGuard(view, "contracts", "read"), async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const q = parseWith(VersionDiffQuerySchema, {
      a: c.req.query("a"),
      b: c.req.query("b"),
      text: c.req.query("text"),
    });
    const u = c.get("user");
    const out = await diff(
      { tenantId: u.tenantId, userId: u.userId },
      id,
      q.a,
      q.b,
      q.text === "1",
    );
    if (!out) throw appError("NOT_FOUND");
    return c.json(out);
  });
  r.get("/contracts/:id/changes-since-last", packGuard(view, "contracts", "read"), async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    const u = c.get("user");
    const i = await packAccessInput(view, "contracts", u);
    const admin = checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
    const out = await changes({ tenantId: u.tenantId, userId: u.userId }, id, admin);
    if (!out) throw appError("NOT_FOUND");
    return c.json(out);
  });
  return r;
}
