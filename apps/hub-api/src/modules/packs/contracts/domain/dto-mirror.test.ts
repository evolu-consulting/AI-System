// ADR-0023 · bản sao kiểu/hằng số ở domain (`*.types.ts`) phải khớp `@ai/contracts`: hằng số bằng nhau (chạy), kiểu gán được hai chiều
// (kiểm lúc typecheck — lệch là `tsc` đỏ ở file này).
import { describe, expect, it } from "bun:test";
import type * as C from "@ai/contracts";
import {
  MYWORK_AHEAD_DAYS as C_AHEAD,
  SOURCING_CANDIDATES_MAX as C_CANDS,
  MANUAL_EVENT_TYPES as C_MANUAL,
  MYWORK_MAX as C_MW_MAX,
  MYWORK_SOURCE_MAX as C_MW_SRC,
  SOURCING_PAGE_SIZE as C_PAGE,
} from "@ai/contracts";
import type * as F from "./followups.types";
import type * as L from "./ledger.types";
import { MANUAL_EVENT_TYPES } from "./ledger.types";
import type * as M from "./mywork.types";
import { MYWORK_AHEAD_DAYS, MYWORK_MAX, MYWORK_SOURCE_MAX } from "./mywork.types";
import type * as S from "./sourcing.types";
import { SOURCING_CANDIDATES_MAX, SOURCING_PAGE_SIZE } from "./sourcing.types";

/** `true` khi A và B gán được cho nhau. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const same = <A, B>(ok: Same<A, B>): Same<A, B> => ok;

describe("ADR-0023 · bản sao DTO ở domain khớp @ai/contracts", () => {
  it("hằng số", () => {
    expect([SOURCING_CANDIDATES_MAX, SOURCING_PAGE_SIZE]).toEqual([C_CANDS, C_PAGE]);
    expect([MYWORK_AHEAD_DAYS, MYWORK_SOURCE_MAX, MYWORK_MAX]).toEqual([
      C_AHEAD,
      C_MW_SRC,
      C_MW_MAX,
    ]);
    expect([...MANUAL_EVENT_TYPES]).toEqual([...C_MANUAL]);
  });
  it("kiểu (typecheck)", () => {
    const checks = [
      same<S.SourcingOut, C.SourcingOut>(true),
      same<S.SaleLine, C.SaleLine>(true),
      same<S.SourceRef, C.SourceRef>(true),
      same<S.SupplierExposure, C.SupplierExposure>(true),
      same<S.SourcingQuery, C.SourcingQuery>(true),
      same<S.SourceChoice, C.SourceChoice>(true),
      same<M.MyWorkOut, C.MyWorkOut>(true),
      same<M.MyWorkItem, C.MyWorkItem>(true),
      same<F.Followup, C.Followup>(true),
      same<F.FollowupCreate, C.FollowupCreate>(true),
      same<L.Obligation, C.Obligation>(true),
      same<L.PaymentsOut, C.PaymentsOut>(true),
      same<L.PartnerEvent, C.PartnerEvent>(true),
      same<L.PartnerEventCreate, C.PartnerEventCreate>(true),
      same<L.ScheduleRequest, C.ScheduleRequest>(true),
      same<L.ContractPartner, C.ContractPartner>(true),
    ];
    expect(checks.every(Boolean)).toBe(true);
  });
});
