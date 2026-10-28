// CR-102 · com-c3 · D3 · service luồng bình luận (T-DEP-1): mỗi hàm MỘT tx gói. Chủ quản chọn luồng (công ty bạn bè còn hiệu
// lực); đối tác luôn luồng công ty mình. RLS chặn ghi (42501) ⇒ 404 như không thấy.
import type { Tx } from "@ai/db";
import { AppError, appError } from "../../../../lib/errors";
import type { PackUow } from "../../kit/application/ports";
import type { StoredText } from "../domain/content.rules";
import type { Access } from "./community-access";
import { postState } from "./post-write.repo";
import {
  type CommentRow,
  insertComment,
  orgMaySee,
  threadComments,
  threadSummaries,
} from "./thread.repo";

type Uow = PackUow<{ tx: Tx }>;

function rlsDenied(e: unknown): boolean {
  for (let x = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++)
    if ((x as { code?: string }).code === "42501") return true;
  return false;
}

/** Luồng đích: đối tác = công ty mình; chủ quản = `orgId` phải là bạn bè còn hiệu lực. */
export function threadOrg(a: Access, orgId: string | undefined): string | null {
  if (a.org !== null) return a.org;
  if (orgId === undefined) return null;
  return a.dir.orgs.some((o) => o.id === orgId && o.active) ? orgId : null;
}

export const summaries = (uow: Uow, a: Access, postId: string) =>
  uow.tenant(a.who, ({ tx }) => threadSummaries(tx, postId));

export async function comments(
  uow: Uow,
  a: Access,
  postId: string,
  org: string,
): Promise<CommentRow[]> {
  const r = await uow.tenant(a.who, ({ tx }) => threadComments(tx, postId, org));
  if (!r.post) throw appError("NOT_FOUND");
  return r.comments;
}

/** Thêm bình luận (mở luồng nếu chưa có); trả luồng đích. */
export function add(
  uow: Uow,
  a: Access,
  postId: string,
  input: { text: StoredText; orgId: string | undefined },
): Promise<string> {
  return uow
    .tenant(a.who, async ({ tx }) => {
      const st = await postState(tx, postId);
      if (!st) throw appError("NOT_FOUND");
      const target = threadOrg(a, input.orgId ?? st.author_org ?? undefined);
      if (!target)
        throw new AppError("THREAD_REQUIRED", 422, "Choose the partner thread to reply in");
      if (a.org === null && !(await orgMaySee(tx, postId, target))) throw appError("NOT_FOUND");
      await insertComment(tx, {
        tenantId: a.who.tenantId,
        postId,
        threadOrg: target,
        userId: a.who.userId,
        authorName: a.dir.userName,
        authorOrg: a.org,
        text: input.text,
      });
      return target;
    })
    .catch((e: unknown) => {
      throw rlsDenied(e) ? appError("NOT_FOUND") : e;
    });
}
