// CR-188 · BR-188-5 · use case «Giấy tờ đã ký bằng chữ ký này»: múi giờ công ty + con trỏ trang + cắt 50 dòng. Truy vấn nằm sau cổng `SigDocsPort`.
import type {
  SigDocItem,
  SigDocKind,
  SigDocsQuery,
  SigDocsResponse,
} from "@ai/contracts/pack-contracts";
import { decodeCursor, pageOf } from "../domain/sig-docs.rules";

export type SigDocsFilter = {
  kind?: SigDocKind | undefined;
  from?: string | undefined;
  to?: string | undefined;
  cursor: { at: string; id: string } | null;
};
export type SigDocsPage = SigDocItem[];
export type SigDocsWho = { tenantId: string; userId: string };

export type SigDocsPort = {
  list: (
    who: SigDocsWho,
    isAdmin: boolean,
    timeZone: string,
    sigId: string,
    f: SigDocsFilter,
  ) => Promise<SigDocsPage>;
};

export type SigDocsDeps = SigDocsPort & { timeZoneOf: (tenantId: string) => Promise<string> };

export function createListSigDocs(d: SigDocsDeps) {
  return async (
    who: SigDocsWho,
    isAdmin: boolean,
    sigId: string,
    q: SigDocsQuery,
  ): Promise<SigDocsResponse> => {
    const rows = await d.list(who, isAdmin, await d.timeZoneOf(who.tenantId), sigId, {
      kind: q.kind,
      from: q.from,
      to: q.to,
      cursor: decodeCursor(q.cursor),
    });
    const { items, next } = pageOf(rows);
    return { items, next_cursor: next };
  };
}
