// dlc-dify · Trello giả lập (DEV): cùng hình REST Trello mà cron dùng — `GET /1/lists/:id`, `GET /1/lists/:id/cards`,
// `GET /1/cards/:id`; thêm thẻ để thử "có ticket mới": `POST /1/cards {idList, name, desc, labels[]}`. Bắt buộc có `key` +
// `token` ở query (như Trello thật). Dữ liệu ở file JSON `TRELLO_MOCK_FILE`. Cổng `TRELLO_MOCK_PORT` (mặc định 4700).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Hono } from "hono";

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
app.use("/1/*", async (c, next) => {
  if (!c.req.query("key") || !c.req.query("token")) return c.text("invalid key", 401);
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
  const b = (await c.req.json()) as {
    idList: string;
    name: string;
    desc?: string;
    labels?: string[];
  };
  const d = read();
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const card: MockCard = {
    id,
    idList: b.idList,
    name: b.name,
    desc: b.desc ?? "",
    labels: (b.labels ?? []).map((name) => ({ name })),
    shortUrl: `https://trello.com/c/${id.slice(0, 8)}`,
  };
  d.cards.push(card);
  save(d);
  return c.json(card);
});

if (import.meta.main) {
  const port = Number(process.env.TRELLO_MOCK_PORT ?? 4700);
  Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });
  console.log(JSON.stringify({ msg: "trello-mock listening", port, file }));
}
