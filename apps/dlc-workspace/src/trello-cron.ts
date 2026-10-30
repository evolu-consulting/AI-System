// dlc-dify · cron Trello: mỗi `TRELLO_POLL_S` giây đọc thẻ của các list theo dõi (REST Trello `GET /1/lists/:id/cards`) và
// đẩy thẻ về hook `POST <DLC_WS_URL>/tickets/hook` (workspace DLC lọc trùng ⇒ chỉ thẻ MỚI thành ticket `new`).
// Env: TRELLO_API_URL (mặc định https://api.trello.com; dev trỏ mock), TRELLO_KEY, TRELLO_TOKEN, TRELLO_LIST_IDS (phẩy),
// TRELLO_POLL_S (mặc định 30), DLC_WS_URL (mặc định http://localhost:4600), DLC_WS_TOKEN. Không log key/token.
type Card = {
  id: string;
  name: string;
  desc?: string;
  url?: string;
  shortUrl?: string;
  labels?: { name?: string; color?: string }[];
  idList?: string;
};

const api = (process.env.TRELLO_API_URL ?? "https://api.trello.com").replace(/\/$/, "");
const key = process.env.TRELLO_KEY ?? "";
const token = process.env.TRELLO_TOKEN ?? "";
const lists = (process.env.TRELLO_LIST_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const pollS = Number(process.env.TRELLO_POLL_S ?? 30);
const ws = (process.env.DLC_WS_URL ?? "http://localhost:4600").replace(/\/$/, "");
const wsToken = process.env.DLC_WS_TOKEN ?? "";

async function listName(id: string): Promise<string> {
  const r = await fetch(`${api}/1/lists/${id}?fields=name&key=${key}&token=${token}`);
  return r.ok ? (((await r.json()) as { name?: string }).name ?? id) : id;
}

export async function pollOnce(): Promise<{ seen: number; added: number }> {
  let seen = 0;
  let added = 0;
  for (const id of lists) {
    const r = await fetch(
      `${api}/1/lists/${id}/cards?fields=name,desc,url,shortUrl,labels,idList&key=${key}&token=${token}`,
    );
    if (!r.ok) {
      console.error(JSON.stringify({ msg: "trello-list-failed", list: id, status: r.status }));
      continue;
    }
    const cards = (await r.json()) as Card[];
    seen += cards.length;
    const name = await listName(id);
    const body = {
      cards: cards.map((c) => ({
        id: c.id,
        name: c.name,
        desc: c.desc ?? "",
        url: c.shortUrl ?? c.url ?? "",
        labels: (c.labels ?? []).map((l) => l.name || l.color || "").filter(Boolean),
        list: name,
      })),
    };
    const h = await fetch(`${ws}/tickets/hook`, {
      method: "POST",
      headers: { Authorization: `Bearer ${wsToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    added += h.ok ? (((await h.json()) as { added?: number }).added ?? 0) : 0;
  }
  return { seen, added };
}

if (import.meta.main) {
  if (lists.length === 0 || !wsToken) {
    console.error("trello-cron: cần TRELLO_LIST_IDS và DLC_WS_TOKEN");
    process.exit(1);
  }
  const tick = async () => {
    try {
      const r = await pollOnce();
      console.log(JSON.stringify({ msg: "trello-poll", ...r, at: new Date().toISOString() }));
    } catch (err) {
      console.error(JSON.stringify({ msg: "trello-poll-failed", error: (err as Error).message }));
    }
  };
  await tick();
  setInterval(tick, pollS * 1000);
}
