// CR-190 · danh bạ nhóm «Nội bộ»: đồng nghiệp NỘI BỘ còn dùng được của CHÍNH công ty (đúng điều kiện tạo 1-1: nhân viên nội bộ, đang dùng, không bị khoá) cộng các id xin thêm (đầu kia/người gửi
// của cuộc đã có, kể cả người đã nghỉ, và chính người gọi để lấy tên) kèm cờ `active` — MỘT câu, lọc tenant tường minh. Đối tác (external) ⇒ rỗng. Trần 5000 người đang dùng.
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { logger } from "../../../../lib/logger";

export type DirectoryPerson = { name: string; active: boolean; job_title: string | null };
const CAP = 5000;

export const internalDirectoryPeople =
  (db: Db) =>
  async (
    who: { tenantId: string; userId: string; userKind?: "internal" | "external" },
    extraIds: readonly string[],
  ): Promise<{ company: { id: string; name: string }; people: Map<string, DirectoryPerson> }> => {
    if (who.userKind === "external")
      return { company: { id: who.tenantId, name: "" }, people: new Map() };
    const extra = `{${[...new Set(extraIds)].join(",")}}`;
    const { rows, company } = await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      async (tx) => ({
        company: (
          await tx.execute<{ id: string; name: string }>(
            sql`select id, name from hub.pmsg_self_company()`,
          )
        )[0],
        rows: await tx.execute<{
          id: string;
          name: string;
          active: boolean;
          job_title: string | null;
        }>(sql`select u.id, u.display_name as name, (u.active and not u.locked_by_tenant) as active, pp.job_title
          from admin.users u
          left join hub.people_profiles pp on pp.tenant_id = u.tenant_id and pp.user_id = u.id
          where u.tenant_id = ${who.tenantId}::uuid and u.kind = 'internal'
            and ((u.active and not u.locked_by_tenant and u.id <> ${who.userId}::uuid) or u.id = any(${extra}::uuid[]))
          order by (u.id = any(${extra}::uuid[])) desc, u.id limit ${CAP}::int`),
      }),
    );
    if (rows.length >= CAP)
      logger.warn("msg-directory-people-cap", { tenant_id: who.tenantId, cap: CAP });
    return {
      company: company ?? { id: who.tenantId, name: "" },
      people: new Map(
        rows.map((r) => [r.id, { name: r.name, active: r.active, job_title: r.job_title }]),
      ),
    };
  };
