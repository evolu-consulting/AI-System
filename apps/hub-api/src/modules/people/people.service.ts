// CR-147b · nghiệp vụ hồ sơ người: tự đổi avatar/ảnh bìa (id LUÔN từ token), đọc thẻ người theo lô (cùng tenant). Không biết HTTP.
import type { MyPeopleProfile, PeopleResponse } from "@ai/contracts/people";
import { withHubScope } from "@ai/db/hub-scope";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { cardsOf, myProfile, setImage } from "./people.repo";

const scopeOf = (u: AuthUser) =>
  ({ kind: "user", tenantId: u.tenantId, userId: u.userId }) as const;

export class PeopleService {
  constructor(private readonly db: Db) {}

  me(u: AuthUser): Promise<MyPeopleProfile> {
    return withHubScope(this.db, scopeOf(u), (tx) => myProfile(tx, u.tenantId, u.userId));
  }

  async setMine(u: AuthUser, col: "avatar" | "cover", value: string | null): Promise<void> {
    await withHubScope(this.db, scopeOf(u), (tx) => setImage(tx, u.tenantId, u.userId, col, value));
  }

  async cards(u: AuthUser, ids: readonly string[]): Promise<PeopleResponse> {
    const items = await withHubScope(this.db, scopeOf(u), (tx) => cardsOf(tx, u.tenantId, ids));
    return { items };
  }
}
