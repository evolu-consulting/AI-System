// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: vòng điều phối demo một hàm cho dễ đọc (như purchase-flow-run.ts)
// CR-140 · chạy thử «Mua hàng» bằng API như người thật: Cường (NV Kinh doanh) gửi phiếu → từng người nhận việc làm / duyệt qua `/me/review-tasks`
// (`POST /review-tasks/:id/form` · `/decision`) tới khi lượt cha xong. Hai lượt: LỚN (600 triệu: đủ A+B+C, Giám đốc duyệt ngân sách) và NHỎ
// (15 triệu: bỏ B). In bảng «bước · người nhận việc · kết quả» (dán vào tasks.md). Dùng cho `bun run demo:purchase --trial`. Chỉ máy dev.

import { caller, env, fail, type Json, login, type Urls } from "./seed-purchase-flow.api";
import { NAMES, stagesA, stagesB, stagesC } from "./seed-purchase-flow.data";

const PEOPLE = [
  "cuong.le",
  "binh.tran",
  "phuc.do",
  "tung.mai",
  "giang.vu",
  "demo-owner",
  "huy.dang",
  "em.hoang",
  "ha.ly",
  "hung.dinh",
  "khoa.bui",
  "lan.ngo",
] as const;

type Row = { step: string; who: string; result: string };
type Fld = { key: string; type: string; required?: boolean };

/** Tên bước «Điền thông tin» → ô của form (nguồn: chính định nghĩa vừa dựng). */
const FORMS = new Map<string, Fld[]>();
for (const st of [...stagesA(), ...stagesB(), ...stagesC()] as Json[])
  if (st.executor?.kind === "form") FORMS.set(String(st.name), st.executor.fields as Fld[]);

const tokens = new Map<string, string>();
async function tokenOf(u: Urls, user: string): Promise<string> {
  const had = tokens.get(user);
  if (had) return had;
  const t = await login(u.authUrl, "demo", user, env("DEMO_OWNER_PW"));
  tokens.set(user, t);
  return t;
}

async function upload(u: Urls, tok: string, name: string): Promise<string> {
  const res = await fetch(`${u.hubUrl}/attachments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tok}`,
      "Content-Type": "application/pdf",
      "X-Filename": encodeURIComponent(name),
    },
    body: `%PDF-1.4\n% ${name} (CR-140 demo)\n%%EOF\n`,
  });
  const j = (await res.json()) as Json;
  if (res.status >= 300 || !j.id)
    fail(`tải tệp ${name} → ${res.status} ${JSON.stringify(j).slice(0, 200)}`);
  return String(j.id);
}

async function fillValues(
  u: Urls,
  tok: string,
  fields: Fld[],
  total: number,
  tag: string,
): Promise<Json> {
  const v: Json = {};
  for (const f of fields) {
    if (f.type === "file_ref") v[f.key] = await upload(u, tok, `${tag}-${f.key}.pdf`);
    else if (f.type === "money")
      v[f.key] =
        f.key === "gia_tri_po" || f.key === "so_tien_tt" || f.key === "so_tien_hd"
          ? total
          : Math.round(total * 0.98);
    else if (f.type === "date") v[f.key] = new Date().toISOString().slice(0, 10);
    else v[f.key] = f.key.startsWith("ncc") ? "Công ty TNHH Thiết bị Minh Phát" : `${f.key} (demo)`;
  }
  return v;
}

/** Một lượt: gửi phiếu bởi Cường, rồi vòng làm/duyệt tới khi hết việc. Trả bảng + trạng thái cuối. */
async function trial(u: Urls, parentKey: string, label: string, total: number): Promise<void> {
  const rows: Row[] = [];
  const starter = await tokenOf(u, "cuong.le");
  const start = await caller(u.hubUrl, starter)("POST", "/processes/start", {
    flow_key: parentKey,
    request_id: crypto.randomUUID(),
    values: {
      ten_hang: `Máy chủ lưu trữ (${label})`,
      so_luong: "3",
      du_toan: total,
      ly_do: "Mở rộng kho dữ liệu (demo CR-140)",
    },
  });
  if (start.status >= 300)
    fail(`bắt đầu phiếu → ${start.status} ${JSON.stringify(start.json).slice(0, 300)}`);
  const runId = String(start.json.run_id);
  rows.push({
    step: "Phiếu yêu cầu mua hàng",
    who: "Lê Minh Cường (NV Kinh doanh)",
    result: `gửi ${total.toLocaleString("vi-VN")} đ → lượt ${runId.slice(0, 8)}`,
  });
  const clients = new Map<string, ReturnType<typeof caller>>();
  for (const p of PEOPLE) clients.set(p, caller(u.hubUrl, await tokenOf(u, p)));
  let idle = 0;
  for (let round = 0; round < 120 && idle < 5; round++) {
    let acted = false;
    for (const p of PEOPLE) {
      const hub = clients.get(p) as ReturnType<typeof caller>;
      const inbox = await hub("GET", "/me/review-tasks?limit=50");
      for (const it of (inbox.json.items as Json[]) ?? []) {
        const t = it.task as Json;
        if (t.status !== "open" || !t.can_act) continue;
        if (!String(it.process_run?.process?.name ?? "").startsWith(NAMES.parent)) continue; // chỉ việc của quy trình mua hàng
        const name = String(t.stage_name);
        const fields = FORMS.get(name);
        const tok = tokens.get(p) as string;
        const res = fields
          ? await hub("POST", `/review-tasks/${t.id}/form`, {
              values: await fillValues(u, tok, fields, total, label),
            })
          : await hub("POST", `/review-tasks/${t.id}/decision`, {
              result: "pass",
              // Duyệt đòi «ý kiến + tệp/chữ ký» (evidence opinion_plus): ý kiến ngắn + một tệp.
              evidence: {
                note: `${p} đồng ý (demo CR-140)`,
                attachment_ids: [await upload(u, tok, `${label}-${p}-y-kien.pdf`)],
              },
            });
        const who = String(it.assignee_name ?? it.assignee_label ?? p);
        rows.push({
          step: name,
          who: `${p} (${who})`,
          result:
            res.status < 300
              ? fields
                ? "đã điền"
                : "Đạt"
              : `LỖI ${res.status} ${JSON.stringify(res.json).slice(0, 160)}`,
        });
        if (res.status < 300) acted = true;
      }
    }
    idle = acted ? 0 : idle + 1;
    if (!acted) await new Promise((r) => setTimeout(r, 1500));
  }
  const fin = await caller(u.hubUrl, starter)("GET", `/processes/requests/${runId}`);
  console.log(
    `\n### Lượt ${label}: ${total.toLocaleString("vi-VN")} đ — trạng thái cuối: ${JSON.stringify(fin.json.status ?? fin.json.run_status ?? fin.status)}`,
  );
  console.log("| # | Bước | Người nhận việc | Kết quả |\n|---|---|---|---|");
  for (const [i, r] of rows.entries())
    console.log(`| ${i + 1} | ${r.step} | ${r.who} | ${r.result} |`);
  console.log(`chi tiết cuối: ${JSON.stringify(fin.json).slice(0, 700)}`);
}

/** Huỷ các lượt mua hàng còn dở của Cường (lần chạy trước) để bảng chỉ có việc của lượt này. */
async function cancelStale(u: Urls): Promise<void> {
  const h = caller(u.hubUrl, await tokenOf(u, "cuong.le"));
  const mine = await h("GET", "/processes/requests/mine");
  for (const r of (mine.json.items as Json[]) ?? [])
    if (r.word !== "done" && String(r.title).startsWith("Mua "))
      await h("POST", `/process-runs/${r.run_id}/cancel`, {});
}

export async function runTrials(u: Urls, _tid: string, parentKey: string): Promise<void> {
  await cancelStale(u);
  await trial(u, parentKey, "lớn", 600_000_000);
  await trial(u, parentKey, "nhỏ", 15_000_000);
}
