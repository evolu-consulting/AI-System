// V2-C · KN-08 · HD-10 · DT-05: route vai đối tác / gợi ý đối tác / ghi chú dưới `/pack/contracts/partners/*`. Đọc = `read`, ghi =
// `write` (guard trước thân); xoá ghi chú người khác cần `admin`. Đầu vào sai ⇒ 400; đối tác ngoài phạm vi ⇒ 404. Không đầu vào nào ra 500.
import {
  PartnerLookupQuerySchema,
  PartnerNoteCreateSchema,
  PartnerNotesQuerySchema,
  PartnerPartyQuerySchema,
  PartnerRolesQuerySchema,
} from "@ai/contracts";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { AppError, appError } from "../../../../lib/errors";
import { parseQuery, parseWith, readJson } from "../../../../lib/http";
import {
  type PackAccessView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "../../kit/adapters/pack-guard.middleware";
import { checkPackAccess } from "../../kit/domain/pack-access.rules";
import { PartnerRolesFail, type PartnerRolesUsecase } from "../application/partner-roles.usecase";
import type { LinkCheckLimit } from "./link-check-limit.redis";

/** Trần một lượt tìm web (CLI có công cụ web chạy lâu hơn lượt trích). */
const SEARCH_TIMEOUT_MS = 120_000;

const KEY = "contracts";

function fail(e: unknown): never {
  if (!(e instanceof PartnerRolesFail)) throw e;
  if (e.kind === "not_found") throw appError("NOT_FOUND");
  if (e.kind === "invalid") throw appError("VALIDATION_ERROR");
  if (e.kind === "ai_unavailable")
    throw new AppError("AGENT_UNAVAILABLE", 503, "AI web search unavailable");
  if (e.kind === "ai_cap") throw new AppError("AI_CAP_EXCEEDED", 429, "AI daily token cap reached");
  if (e.kind === "ai_failed") throw new AppError("AGENT_FAILED", 502, "AI web search failed");
  throw new AppError("PACK_FORBIDDEN", 403, "Chỉ người viết hoặc quản lý được xoá ghi chú");
}
const run = <T>(p: Promise<T>): Promise<T> => p.catch(fail);
const who = (c: Context<PackGuardVars>) => {
  const u = c.get("user");
  return { tenantId: u.tenantId, userId: u.userId };
};

export function partnerRolesRoutes(
  view: PackAccessView,
  uc: PartnerRolesUsecase,
  limit?: LinkCheckLimit,
): Hono<PackGuardVars> {
  const r = new Hono<PackGuardVars>();
  const read = packGuard(view, KEY, "read");
  const write = packGuard(view, KEY, "write");
  const isAdmin = async (c: Context<PackGuardVars>) => {
    const i = await packAccessInput(view, KEY, c.get("user"));
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.admin }) === "ok";
  };

  r.get("/partners/roles", read, async (c) =>
    c.json(await run(uc.roles(who(c), parseQuery(c, PartnerRolesQuerySchema).party))),
  );
  r.get("/partners/lookup", read, async (c) =>
    c.json(await run(uc.lookup(who(c), parseQuery(c, PartnerLookupQuerySchema)))),
  );
  r.get("/partners/notes", read, async (c) =>
    c.json(await run(uc.notes(who(c), parseQuery(c, PartnerNotesQuerySchema).party))),
  );
  r.post("/partners/notes", write, async (c) => {
    const b = parseWith(PartnerNoteCreateSchema, await readJson(c));
    return c.json(await run(uc.addNote(who(c), b.party, b.body, b.source)), 201);
  });
  // V2-I: đầu trang chi tiết · tab Hợp đồng · số HĐ trên danh sách · "Tìm trên internet" (chạy khi bấm, tên + MST).
  r.get("/partners/profile", read, async (c) =>
    c.json(await run(uc.profile(who(c), parseQuery(c, PartnerPartyQuerySchema).party))),
  );
  r.get("/partners/contracts", read, async (c) =>
    c.json(await run(uc.contracts(who(c), parseQuery(c, PartnerPartyQuerySchema).party))),
  );
  r.get("/partners/contract-counts", read, async (c) =>
    c.json(await run(uc.contractCounts(who(c)))),
  );
  r.post("/partners/internet-search", write, async (c) => {
    const b = parseWith(PartnerPartyQuerySchema, await readJson(c));
    if (limit) await limit(who(c).tenantId, who(c).userId);
    const signal = AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(SEARCH_TIMEOUT_MS)]);
    return c.json(await run(uc.internetSearch(who(c), b.party, signal)));
  });
  r.delete("/partners/notes/:id", write, async (c) => {
    const id = parseWith(z.uuid(), c.req.param("id"));
    return c.json(await run(uc.deleteNote(who(c), id, await isAdmin(c))));
  });
  return r;
}
