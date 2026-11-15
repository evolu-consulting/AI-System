// CR-169 · lát 6 · loại cuộc theo id: cuộc `partner` đi đường `/messages/partner/:id/*`, nội bộ đi `/messages/conversations/:id/*` (spec §4).
// Nhớ loại từ danh sách / chi tiết / tạo mới; id lạ (mở thẳng từ đường dẫn) ⇒ chưa biết, api thử nội bộ rồi partner.
import type { ConvKind } from "@ai/contracts/pack-contracts";

const kinds = new Map<string, ConvKind>();
const MAX = 2000;

export function rememberKind(id: string, kind: ConvKind): void {
  if (kinds.size >= MAX && !kinds.has(id)) {
    const first = kinds.keys().next().value;
    if (first !== undefined) kinds.delete(first);
  }
  kinds.set(id, kind);
}

export const rememberKinds = (items: readonly { id: string; kind: ConvKind }[]): void => {
  for (const c of items) rememberKind(c.id, c.kind);
};

export const kindOf = (id: string): ConvKind | undefined => kinds.get(id);
export const isPartnerId = (id: string): boolean => kinds.get(id) === "partner";
export const forgetKinds = (): void => kinds.clear();
