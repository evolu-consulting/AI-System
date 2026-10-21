// one-agent · dựng khối ngữ cảnh cho run E12 từ `context` của tin + header `X-Ai-Surface`. Bản ghi đang xem chỉ được nhắc khi
// người gọi THẤY nó (nhãn lấy qua gói bằng RLS của người gọi — `ContextLabeler`); id lạ / không thấy / lỗi ⇒ bỏ phần đó.
import type { AiSurface, MessageContext } from "@ai/contracts/chat";
import type { ContextLabeler } from "../packs/kit/application/context.ports";
import { entityToCheck, surfaceBlock } from "./surface-context.rules";

export async function surfaceNote(
  labeler: ContextLabeler | undefined,
  who: { tenantId: string; userId: string },
  ctx: MessageContext | undefined,
  headerSurface: AiSurface | null,
): Promise<string | null> {
  const surface = ctx?.surface ?? headerSurface;
  const want = entityToCheck(ctx);
  const label = want && labeler ? await labeler.contextLabel(who, want.kind, want.id) : null;
  const entity = want && label ? { ...want, label } : null;
  return surfaceBlock({ surface, route: ctx?.route, entity });
}
