// HUB-FR-102 · nghiệp vụ danh bạ (X2a plan §3, D16): người cùng tenant để mở DM / thêm vào nhóm. Không biết HTTP.
import type { DirectoryQuery, DirectoryResponse } from "@ai/contracts/chat";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { searchUsers } from "./directory.repo";
import { likePattern } from "./directory.rules";

export class DirectoryService {
  constructor(private readonly db: Db) {}

  async search(user: AuthUser, q: DirectoryQuery): Promise<DirectoryResponse> {
    const scope = { kind: "user", tenantId: user.tenantId, userId: user.userId } as const;
    const rows = await withHubScope(this.db, scope, (tx) =>
      searchUsers(tx, {
        tenantId: user.tenantId,
        selfId: user.userId,
        pattern: q.q === undefined ? undefined : likePattern(q.q),
        limit: q.limit,
      }),
    );
    // Dựng lại từng item: dù driver trả thêm cột gì, response chỉ có 4 trường.
    return {
      items: rows.map((r) => ({
        id: r.id,
        display_name: r.display_name,
        username: r.username,
        active: r.active,
      })),
    };
  }
}
