// CR-122 · E5 · danh bạ công ty cho node Ký số: Group để chọn (panel) + đổi mục `user`/`group` thành user ký (kiểm thuộc công ty). Schema
// `admin` (role gói không đọc) ⇒ scope system hub; MỖI hàm MỘT câu, `tenant_id` tường minh (Luật 4c), không theo hàng.
import type { EsignNodeSigner } from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import { companyGroups, directoryRows } from "../../kit/public";
import type { NodeDirectory } from "../application/esign.usecase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUPS_MAX = 200;

export function esignNodeDirectory(db: Db): NodeDirectory {
  return {
    async groups(tenantId) {
      if (!UUID.test(tenantId)) return [];
      const rows = await companyGroups(db, tenantId, GROUPS_MAX);
      return rows;
    },

    /** Một câu: người cụ thể (còn dùng được) + Group của công ty + thành viên còn dùng được của các Group đó. */
    async resolve(tenantId, entries) {
      const users = [...new Set(entries.filter((e) => e.kind === "user").map((e) => e.id))];
      const groups = [...new Set(entries.filter((e) => e.kind === "group").map((e) => e.id))];
      if (!UUID.test(tenantId) || [...users, ...groups].some((i) => !UUID.test(i)))
        return { userIds: [], unknown: [...entries] };
      const rows = await directoryRows(db, tenantId, users, groups);
      const okUser = new Set(rows.filter((r) => r.k === "user").map((r) => r.id));
      const okGroup = new Set(rows.filter((r) => r.k === "group").map((r) => r.id));
      const unknown: EsignNodeSigner[] = entries.filter((e) =>
        e.kind === "user" ? !okUser.has(e.id) : !okGroup.has(e.id),
      );
      // Thứ tự khai: người cụ thể theo danh sách, rồi thành viên từng Group theo thứ tự Group khai (bỏ trùng).
      const byGroup = new Map<string, string[]>();
      for (const r of rows)
        if (r.k === "member" && r.g) byGroup.set(r.g, [...(byGroup.get(r.g) ?? []), r.id]);
      const ordered = entries.flatMap((e) =>
        e.kind === "user"
          ? okUser.has(e.id)
            ? [e.id]
            : []
          : [...(byGroup.get(e.id) ?? [])].sort(),
      );
      return { userIds: [...new Set(ordered)], unknown };
    },
  };
}
