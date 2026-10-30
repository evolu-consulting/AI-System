// dlc-dify · hộp ticket Trello của workspace DLC: cron gọi `POST /tickets/hook` với thẻ của các list theo dõi (chỉ thẻ MỚI
// thành ticket `new`), dlc-agent liệt kê / đọc ticket, flow quy trình đánh dấu `taken` khi nhận và `done` khi xong.
import type { Hono } from "hono";
import { z } from "zod";
import { body, HttpError, now } from "./http";
import type { Store, Ticket } from "./store";

type Card = {
  id: string;
  name: string;
  desc?: string;
  url?: string;
  labels?: string[];
  list?: string;
};

/** Thẻ Trello → ticket `new`; nhãn/tên có "bug/lỗi/fix" ⇒ loại bug, còn lại enhancement. */
function ticketOf(card: Card): Ticket {
  const labels = card.labels ?? [];
  const bug =
    labels.some((l) => /bug|lỗi|loi|fix/i.test(l)) || /\b(bug|lỗi|fix)\b/i.test(card.name);
  return {
    id: `t-${card.id.slice(-8)}`,
    card_id: card.id,
    name: card.name,
    desc: card.desc ?? "",
    url: card.url ?? "",
    labels,
    list: card.list ?? "",
    kind: bug ? "bug" : "enhancement",
    project_key: null,
    status: "new",
    received_at: now(),
    updated_at: now(),
  };
}

const CardSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(500),
  desc: z.string().max(50_000).optional(),
  url: z.string().max(500).optional(),
  labels: z.array(z.string().max(80)).max(20).optional(),
  list: z.string().max(120).optional(),
});

const sameTicket = (id: string) => (x: Ticket) => x.id === id || x.card_id === id;

export function ticketRoutes(app: Hono, store: Store): void {
  app.post("/tickets/hook", async (c) => {
    const b = await body(c, z.object({ cards: z.array(CardSchema).max(200) }));
    const added = await store.updateTickets((t) => {
      const fresh = b.cards.filter((card) => !t.some((x) => x.card_id === card.id)).map(ticketOf);
      return { tickets: [...t, ...fresh], value: fresh.length };
    });
    return c.json({ added });
  });
  app.get("/tickets", (c) => {
    const st = c.req.query("status");
    const items = store.tickets().filter((t) => !st || t.status === st);
    return c.json({
      items: items.map(({ desc, ...t }) => ({ ...t, summary: desc.slice(0, 200) })),
    });
  });
  app.get("/tickets/:id", (c) => {
    const t = store.tickets().find(sameTicket(c.req.param("id")));
    if (!t) throw new HttpError(404, "ticket not found");
    return c.json(t);
  });
  app.patch("/tickets/:id", async (c) => {
    const b = await body(
      c,
      z.object({
        status: z.enum(["new", "taken", "done"]).optional(),
        project_key: z.string().max(48).optional(),
      }),
    );
    const t = await store.updateTickets((all) => {
      const i = all.findIndex(sameTicket(c.req.param("id")));
      if (i < 0) return { tickets: all, value: null };
      const cur = all[i] as Ticket;
      const upd: Ticket = {
        ...cur,
        ...(b.status && { status: b.status }),
        ...(b.project_key && { project_key: b.project_key }),
        updated_at: now(),
      };
      const out = [...all];
      out[i] = upd;
      return { tickets: out, value: upd };
    });
    if (!t) throw new HttpError(404, "ticket not found");
    return c.json(t);
  });
}
