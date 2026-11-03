// dlc-dify · Trello giả lập (DEV): cùng hình REST Trello mà cron dùng — `GET /1/lists/:id`, `GET /1/lists/:id/cards`,
// `GET /1/cards/:id`; thêm thẻ để thử "có ticket mới": `POST /1/cards {idList, name, desc, labels[]}`. Bắt buộc có `key` +
// `token` ở query (như Trello thật). Dữ liệu ở file JSON `TRELLO_MOCK_FILE`. Cổng `TRELLO_MOCK_PORT` (mặc định 4700).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type Context, Hono } from "hono";

type MockCard = {
  id: string;
  idList: string;
  name: string;
  desc: string;
  labels: { name: string }[];
  shortUrl: string;
};
type MockData = { lists: { id: string; name: string }[]; cards: MockCard[] };

const file = process.env.TRELLO_MOCK_FILE ?? "trello-mock.json";
const read = (): MockData =>
  existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as MockData)
    : { lists: [], cards: [] };
const save = (d: MockData) => writeFileSync(file, JSON.stringify(d, null, 2));

const app = new Hono();
/** Body của POST: JSON (thử tay) hoặc form-urlencoded / multipart (admin-api đẩy góp ý như Trello thật). */
async function bodyOf(c: Context): Promise<Record<string, unknown>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json"))
    return ((await c.req.json()) ?? {}) as Record<string, unknown>;
  return (await c.req.parseBody()) as Record<string, unknown>;
}

app.use("/1/*", async (c, next) => {
  if (c.req.query("key") && c.req.query("token")) return next();
  // Trello thật nhận key/token trong body (admin-api gửi như vậy, không đặt token trên URL).
  const b = c.req.method === "POST" ? await bodyOf(c) : {};
  if (!b.key || !b.token) return c.text("invalid key", 401);
  return next();
});
app.get("/1/lists/:id", (c) => {
  const l = read().lists.find((x) => x.id === c.req.param("id"));
  return l ? c.json(l) : c.text("invalid id", 404);
});
app.get("/1/lists/:id/cards", (c) =>
  c.json(read().cards.filter((x) => x.idList === c.req.param("id"))),
);
app.get("/1/cards/:id", (c) => {
  const x = read().cards.find((k) => k.id === c.req.param("id"));
  return x ? c.json(x) : c.text("invalid id", 404);
});
app.post("/1/cards", async (c) => {
  const b = (await bodyOf(c)) as {
    idList?: string;
    name?: string;
    desc?: string;
    labels?: unknown;
  };
  const d = read();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const labels = Array.isArray(b.labels) ? b.labels.map(String) : [];
  const card: MockCard = {
    id,
    idList: String(b.idList ?? ""),
    name: String(b.name ?? ""),
    desc: String(b.desc ?? ""),
    labels: labels.map((name) => ({ name })),
    shortUrl: `https://trello.com/c/${id.slice(0, 8)}`,
  };
  d.cards.push(card);
  save(d);
  return c.json(card);
});
/** Đính kèm tệp (admin-api gửi ảnh chụp góp ý): ghi nhận tên, không lưu nội dung. */
app.post("/1/cards/:id/attachments", async (c) => {
  const b = await bodyOf(c);
  return c.json({ id: crypto.randomUUID().slice(0, 24), name: String(b.name ?? "file") });
});

if (import.meta.main) {
  const port = Number(process.env.TRELLO_MOCK_PORT ?? 4700);
  Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });
  console.log(JSON.stringify({ msg: "trello-mock listening", port, file }));
}
