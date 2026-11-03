// dlc-dify · hộp ticket Trello của workspace DLC: cron gọi `POST /tickets/hook` với thẻ của các list theo dõi (chỉ thẻ MỚI
// thành ticket `new`), dlc-agent liệt kê / đọc ticket, flow quy trình đánh dấu `taken` khi nhận và `done` khi xong.
import type { Hono } from "hono";
import { z } from "zod";
import { body, HttpError, KEY_RE, now } from "./http";
import type { Project, Store, Ticket } from "./store";

type Card = {
  id: string;
  name: string;
  desc?: string;
  url?: string;
  labels?: string[];
  list?: string;
};

const line = (desc: string, label: string) =>
  new RegExp(`^\\s*${label}\\s*:\\s*(.+?)\\s*$`, "im").exec(desc)?.[1] ?? "";

/** Project nguồn của thẻ: `DLC project:` (project có thật) trước, sau đó `App:` khớp `apps` / tên project. */
export function sourceOf(
  desc: string,
  projects: Project[],
): { app: string; project: string | null } {
  const app = line(desc, "App");
  const key = line(desc, "DLC project").toLowerCase();
  if (KEY_RE.test(key) && projects.some((p) => p.key === key)) return { app, project: key };
  const a = app.toLowerCase();
  const hit = a
    ? projects.find(
        (p) => p.title.toLowerCase() === a || (p.apps ?? []).some((x) => x.toLowerCase() === a),
      )
    : undefined;
  return { app, project: hit?.key ?? null };
}

/** Thẻ Trello → ticket `new`; nhãn/tên có "bug/lỗi/fix" ⇒ loại bug, còn lại enhancement. */
function ticketOf(card: Card, projects: Project[]): Ticket {
  const labels = card.labels ?? [];
  const bug =
    labels.some((l) => /bug|lỗi|loi|fix/i.test(l)) || /\b(bug|lỗi|fix)\b/i.test(card.name);
  const src = sourceOf(card.desc ?? "", projects);
  return {
    id: `t-${card.id.slice(-8)}`,
    card_id: card.id,
    name: card.name,
    desc: card.desc ?? "",
    url: card.url ?? "",
    labels,
    list: card.list ?? "",
    kind: bug ? "bug" : "enhancement",
    app: src.app,
    project_key: src.project,
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
    const projects = store.projects();
    const added = await store.updateTickets((t) => {
      const fresh = b.cards
        .filter((card) => !t.some((x) => x.card_id === card.id))
        .map((card) => ticketOf(card, projects));
      return { tickets: [...t, ...fresh], value: fresh.length };
    });
    return c.json({ added });
  });
  app.get("/tickets", (c) => {
    const st = c.req.query("status");
    // Không lọc ⇒ mọi ticket trừ `dismissed` (thẻ thử nghiệm / rác đã gạt khỏi hộp).
    const items = store.tickets().filter((t) => (st ? t.status === st : t.status !== "dismissed"));
    return c.json({
      items: items.map(({ desc, ...t }) => ({ ...t, summary: desc.slice(0, 200) })),
    });
  });
  app.get("/tickets/:id", (c) => {
    const t = store.tickets().find(sameTicket(c.req.param("id")));
    if (!t) throw new HttpError(404, "ticket not found");
    return c.json(t);
  });
  patchRoute(app, store);
}

/** Đổi trạng thái / project của ticket (flow quy trình; `dismissed` = gạt thẻ thử nghiệm khỏi hộp). */
function patchRoute(app: Hono, store: Store): void {
  app.patch("/tickets/:id", async (c) => {
    const b = await body(
      c,
      z.object({
        status: z.enum(["new", "taken", "done", "dismissed"]).optional(),
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
