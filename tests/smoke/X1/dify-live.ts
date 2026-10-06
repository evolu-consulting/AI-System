// X1-AC20 · X1-R01 · X1-R02 · smoke Dify THẬT — KIỂM TAY (test-plan §6, Q8). Agent KHÔNG tự chạy khi người dùng chưa bảo.
// Chạy: `DIFY_LIVE=1 bun --env-file=.env.local tests/smoke/X1/dify-live.ts --apps translate[,gmail-summary,…]`
// Điều kiện: `bun run combine:dev` đang chạy, người dùng đã `bun run seed:dify -- --apply`.
// Luật: chỉ gọi Hub (service API qua Hub) + đăng nhập; mỗi app ĐÚNG 1 lần gửi tin, tuần tự, KHÔNG retry, không đọc DB,
// không gọi console API của Dify, không /parameters, /info; không tạo/sửa/publish flow. Bộ đếm nằm trong script:
// vượt 1 lần/app ⇒ dừng + exit 1. Vắng DIFY_LIVE=1 ⇒ in "bỏ qua" và exit 0, KHÔNG mở kết nối mạng nào.
// Biến: SMOKE_HUB_URL (mặc định http://localhost:4000), SMOKE_AUTH_URL (mặc định http://localhost:3001),
// SMOKE_TENANT (acme), SMOKE_USERNAME (lan), SMOKE_PASSWORD (bắt buộc khi chạy thật; không in ra).

const APPS = ["translate", "gmail-summary", "email-reply", "screenshot-ask", "chatbot"] as const;
type App = (typeof APPS)[number];

const SAMPLE_EMAIL = [
  "Chào anh Minh,",
  "Bên em xin gửi lại báo giá phần mềm kế toán cho quý 4, tổng 45 triệu đồng, đã gồm VAT.",
  "Anh xem giúp và phản hồi trước thứ Sáu để bên em giữ giá ưu đãi.",
  "Trân trọng, Lan",
].join(" ");

/** Nội dung gửi của từng app (đúng 1 tin/app). */
const MESSAGE: Record<App, string> = {
  translate: "/translate en Xin chào, hôm nay trời đẹp.",
  "gmail-summary": `/summary ${SAMPLE_EMAIL}`,
  "email-reply": `/reply ${SAMPLE_EMAIL}`,
  "screenshot-ask": "/ask-image Ảnh này có màu gì?",
  chatbot: "@dify-chatbot Xin chào",
};

function parseApps(argv: string[]): App[] | string {
  const i = argv.indexOf("--apps");
  if (i < 0 || !argv[i + 1]) return `thiếu --apps (chọn trong: ${APPS.join(",")})`;
  const list = (argv[i + 1] as string)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = list.filter((a) => !(APPS as readonly string[]).includes(a));
  if (bad.length) return `app không hợp lệ: ${bad.join(",")} (chọn trong: ${APPS.join(",")})`;
  return [...new Set(list)] as App[];
}

/** PNG 1×1 đỏ, dựng trong script (không đọc file). */
function tinyPng(): Blob {
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  return new Blob([Buffer.from(b64, "base64")], { type: "image/png" });
}

/** Đọc biến môi trường (một chỗ; script tay, không thuộc task turbo). */
const env = (k: string): string | undefined => process.env[k];

/** Bộ đếm lời gọi (mỗi app đúng 1). Gọi lần 2 ⇒ ném lỗi — không bao giờ có retry. */
export function makeCounter() {
  const n = new Map<App, number>();
  return {
    take(app: App): void {
      const c = (n.get(app) ?? 0) + 1;
      n.set(app, c);
      if (c > 1) throw new Error(`vượt 1 lời gọi cho app ${app} (${c})`);
    },
    get: (app: App): number => n.get(app) ?? 0,
    summary: (): string => [...n.entries()].map(([a, c]) => `${a}=${c}`).join(" "),
  };
}

async function readTerminal(res: Response): Promise<{ event: string; text: string }> {
  const reader = res.body?.getReader();
  if (!reader) return { event: "none", text: "" };
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const name of ["run.finished", "run.failed"]) {
      const m = buf.match(new RegExp(`event: ${name.replace(".", "\\.")}\\ndata: (.*)\\n`));
      if (m) {
        await reader.cancel().catch(() => undefined);
        return { event: name, text: m[1] ?? "" };
      }
    }
  }
  return { event: "none", text: "" };
}

type Ctx = { hub: string; H: Record<string, string>; counter: ReturnType<typeof makeCounter> };

/** Một app: tạo hội thoại, (upload ảnh), gửi ĐÚNG 1 tin, đọc tới sự kiện cuối. Trả true khi có kết quả. */
async function runApp(app: App, c: Ctx): Promise<boolean> {
  const json = { ...c.H, "content-type": "application/json" };
  const conv = await fetch(`${c.hub}/conversations`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ title: `Smoke X1 ${app}` }),
  });
  if (conv.status !== 201) {
    console.error(`[${app}] tạo hội thoại lỗi ${conv.status}`);
    return false;
  }
  const convId = ((await conv.json()) as { id: string }).id;
  const body: Record<string, unknown> = { content: MESSAGE[app] };
  if (app === "screenshot-ask") {
    const up = await fetch(`${c.hub}/attachments`, {
      method: "POST",
      headers: { ...c.H, "content-type": "image/png", "X-Filename": "smoke-x1.png" },
      body: tinyPng(),
    });
    if (up.status !== 201) {
      console.error(`[${app}] upload ảnh lỗi ${up.status}`);
      return false;
    }
    body.attachment_ids = [((await up.json()) as { id: string }).id];
  }
  c.counter.take(app); // đúng 1 lần gửi/app, đếm TRƯỚC khi gọi; không retry
  const t0 = Date.now();
  const res = await fetch(`${c.hub}/conversations/${convId}/messages`, {
    method: "POST",
    headers: json,
    body: JSON.stringify(body),
  });
  if (res.status !== 200) {
    console.error(`[${app}] gửi lỗi ${res.status}`);
    return false;
  }
  const end = await readTerminal(res);
  const ok =
    end.event === "run.finished" &&
    end.text.includes('"content":"') &&
    !end.text.includes('"content":""');
  console.log(`[${app}] ${ok ? "OK" : "LỖI"} ${end.event} ${Date.now() - t0} ms`);
  return ok;
}

async function main(): Promise<number> {
  if (env("DIFY_LIVE") !== "1") {
    console.log("smoke X1 Dify thật: bỏ qua (vắng DIFY_LIVE=1)");
    return 0;
  }
  const apps = parseApps(process.argv.slice(2));
  if (typeof apps === "string") {
    console.error(`smoke X1: ${apps}`);
    return 1;
  }
  const password = env("SMOKE_PASSWORD");
  if (!password) {
    console.error("smoke X1: thiếu SMOKE_PASSWORD");
    return 1;
  }
  const hub = (env("SMOKE_HUB_URL") ?? "http://localhost:4000").replace(/\/$/, "");
  const auth = (env("SMOKE_AUTH_URL") ?? "http://localhost:3001").replace(/\/$/, "");
  const login = await fetch(`${auth}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_key: env("SMOKE_TENANT") ?? "acme",
      username: env("SMOKE_USERNAME") ?? "lan",
      password,
    }),
  });
  if (login.status !== 200) {
    console.error(`smoke X1: đăng nhập lỗi ${login.status}`);
    return 1;
  }
  const token = ((await login.json()) as { access_token: string }).access_token;
  const ctx: Ctx = { hub, H: { authorization: `Bearer ${token}` }, counter: makeCounter() };
  let failed = 0;
  for (const app of apps) if (!(await runApp(app, ctx))) failed++; // tuần tự
  console.log(`smoke X1: số lời gọi ${ctx.counter.summary()}`);
  for (const app of apps) if (ctx.counter.get(app) > 1) failed++;
  return failed === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(await main());
