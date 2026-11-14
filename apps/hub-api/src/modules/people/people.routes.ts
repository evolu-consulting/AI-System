// CR-147b · `/people*` (JWT ở gốc qua PROTECTED_PREFIXES). `GET /me`, `PUT /me/avatar`, `PUT /me/cover`: chỉ hồ sơ CỦA CHÍNH MÌNH
// (không có `:id` ⇒ không thể sửa của người khác). `GET /?ids=` thẻ người theo lô (tên, chức vụ, avatar, phòng ban) — một câu SQL.
import { AvatarSetSchema, PeopleQuerySchema, PersonCoverSetSchema } from "@ai/contracts/people";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { parseJson, parseQuery } from "../../lib/http";
import type { PeopleService } from "./people.service";

export function peopleRoutes(svc: PeopleService): Hono<AuthVars> {
  const r = new Hono<AuthVars>();
  r.get("/me", async (c) => c.json(await svc.me(c.var.user)));
  r.put("/me/avatar", async (c) => {
    const { avatar } = await parseJson(c, AvatarSetSchema);
    await svc.setMine(c.var.user, "avatar", avatar);
    return c.json({ avatar });
  });
  r.put("/me/cover", async (c) => {
    const { cover } = await parseJson(c, PersonCoverSetSchema);
    await svc.setMine(c.var.user, "cover", cover);
    return c.json({ cover });
  });
  r.get("/", async (c) =>
    c.json(await svc.cards(c.var.user, parseQuery(c, PeopleQuerySchema).ids)),
  );
  return r;
}
