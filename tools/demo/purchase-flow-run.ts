// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: kịch bản demo đọc biến môi trường
// biome-ignore-all lint/suspicious/noExplicitAny: JSON phản hồi API không có kiểu (kịch bản demo)
// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: vòng điều phối demo, một hàm cho dễ đọc
// CR-125 · chạy quy trình MUA HÀNG đầu-cuối bằng API thật (hub): HĐ mua được tải lên + AI giả đọc → «Gửi duyệt» → bộ điều phối mở flow →
// từng vai làm/duyệt theo thứ tự qua `/me/review-tasks`. `UAT_PORT_BASE=3800 bun --env-file=.env.local tools/demo/purchase-flow-run.ts [ok|reject]`
// Cần hub-api chạy với AI_PROVIDER=subscription + AI_SUB_CLI_PATH (CLI giả) + ESIGN_PROVIDERS=selfsign (xem purchase-flow-trial.md).
// pdf-lib là phụ thuộc của hub-api (không có ở gốc) ⇒ nhập theo đường dẫn của gói đó
import { PDFDocument } from "../../apps/hub-api/node_modules/pdf-lib";
import { DEMO_PW, ROLES, TENANT } from "./purchase-flow-data";
import { purchaseStages } from "./purchase-flow-def";
import { login, platformToken, urlsFromBase } from "./purchase-flow-setup";

const u = urlsFromBase();
type Json = Record<string, any>;
const mode = process.argv[2] ?? "ok";
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function tokenOf(user: string, pw = DEMO_PW, tenant: string = TENANT.key): Promise<string> {
  const r = await login(u.api, tenant, user, pw);
  if (r.status !== "authenticated") throw new Error(`đăng nhập ${user}: ${String(r.status)}`);
  return String(r.access_token);
}
async function hub(
  tok: string,
  method: string,
  path: string,
  body?: unknown,
  form?: FormData,
): Promise<{ status: number; json: Json }> {
  const res = await fetch(`${u.hub}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${tok}`,
      ...(form ? {} : { "content-type": "application/json" }),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const t = await res.text();
  return { status: res.status, json: t ? (JSON.parse(t) as Json) : {} };
}

/** Chuẩn bị: công ty có quy trình mua hàng ĐANG ÁP DỤNG (bản công ty), tắt quy trình mặc định, vai gói Hợp đồng cho mọi người. */
async function prepare(): Promise<void> {
  const ptok = await platformToken(u.api);
  const tenants = (await (
    await fetch(`${u.api}/admin/tenants?q=${TENANT.key}&limit=50`, {
      headers: { authorization: `Bearer ${ptok}` },
    })
  ).json()) as Json;
  const tid = String(tenants.items.find((t: Json) => t.key === TENANT.key).id);
  const atok = await tokenOf("quantri");
  const list = (await hub(atok, "GET", `/tenants/${tid}/company-flows`)).json.items as Json[];
  const copy = list.find(
    (f) =>
      /Sao từ/.test(String(f.source_label ?? f.origin ?? "")) ||
      f.kind === "copy" ||
      f.kind === "company",
  );
  log(
    `company-flows: ${list.map((f) => `${f.name}[${f.kind},${f.enabled ? "on" : "off"}]`).join(" | ")}`,
  );
  if (copy && process.env.PATCH_COPY) {
    // đưa cấu hình mới nhất vào BẢN CÔNG TY (bản sao cũ chụp từ Thư viện lúc trước) rồi áp dụng lại
    const cur = (await hub(atok, "GET", `/process-defs/${copy.flow_id ?? copy.def_id}`)).json;
    // Ký số: người ký công ty = nhóm Giám đốc (id nhóm của CÔNG TY — Thư viện không ghi được vì không có id; gap G11)
    const gq = (await (
      await fetch(`${u.api}/admin/groups?tenant_id=${tid}&q=giam-doc&limit=20`, {
        headers: { authorization: `Bearer ${ptok}` },
      })
    ).json()) as Json;
    const gid = String((gq.items as Json[]).find((g) => g.key === "giam-doc")?.id);
    const put = await hub(atok, "PUT", `/process-defs/${cur.id}`, {
      ...Object.fromEntries(
        [
          "key",
          "name",
          "description",
          "input_hint",
          "run_group_ids",
          "token_budget",
          "enabled",
          "sources",
          "inputs",
          "ttl_days",
          "trigger",
          "app",
        ].map((k) => [k, cur[k]]),
      ),
      stages: purchaseStages(gid).stages,
      version: cur.version,
    });
    log(
      `cập nhật bản công ty ${put.status} ${put.status >= 300 ? JSON.stringify(put.json).slice(0, 300) : ""}`,
    );
    log(
      `áp dụng lại ${(await hub(atok, "POST", `/tenants/${tid}/company-flows/${copy.id}/publish`)).status}`,
    );
  }
  if (copy && !copy.enabled)
    log(
      `publish bản công ty: ${(await hub(atok, "POST", `/tenants/${tid}/company-flows/${copy.id}/publish`)).status}`,
    );
  for (const f of list.filter(
    (x) => x.kind === "assigned" && /mặc định/.test(String(x.name)) && x.enabled,
  ))
    log(
      `tắt ${f.name}: ${(await hub(atok, "PATCH", `/tenants/${tid}/company-flows/${f.id}`, { enabled: false })).status}`,
    );
  // vai gói Hợp đồng
  const packs = (await (
    await fetch(`${u.api}/admin/tenants/${tid}/packs/contracts`, {
      method: "PUT",
      headers: { authorization: `Bearer ${ptok}` },
    })
  ).json()) as Json;
  const editor = (packs.groups as Json[] | undefined)?.find((g) => g.role === "editor")?.group_id;
  const owner = (packs.groups as Json[] | undefined)?.find((g) => g.role === "owner")?.group_id;
  if (owner)
    await fetch(`${u.api}/admin/groups/${owner}/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${ptok}`, "content-type": "application/json" },
      body: JSON.stringify({ usernames: ["quantri"] }),
    });
  // bật ký số cho công ty («Ký thử» = nhà cung cấp selfsign, hub chạy ESIGN_PROVIDERS=selfsign)
  const es = await hub(await tokenOf("quantri"), "PUT", "/pack/contracts/esign/settings", {
    enabled: true,
    default_provider: "selfsign",
  });
  log(`bật ký số ${es.status} ${JSON.stringify(es.json).slice(0, 160)}`);
  if (editor)
    await fetch(`${u.api}/admin/groups/${editor}/members`, {
      method: "POST",
      headers: { authorization: `Bearer ${ptok}`, "content-type": "application/json" },
      body: JSON.stringify({ usernames: [...new Set(Object.values(ROLES).map((r) => r.user))] }),
    });
  log("sẵn sàng");
}

const stages = purchaseStages().stages as Json[];
const sample = (f: Json): unknown =>
  ({
    text: "Mẫu hư cấu",
    textarea: "Mô tả hư cấu",
    number: 10,
    money: 480_000_000,
    date: "2026-11-20",
    checkbox: true,
  })[f.type as string];

/** Mỗi vòng: duyệt hộp việc của mọi người; làm form / quyết duyệt đúng thứ tự tới khi lượt chạy xong hoặc kẹt. */
async function walk(starter: string, cid: string): Promise<void> {
  const users = [...new Set(Object.values(ROLES).map((r) => r.user))];
  const toks = new Map<string, string>();
  for (const x of users) toks.set(x, await tokenOf(x));
  let idle = 0;
  let looped = false;
  for (let round = 0; round < 80 && idle < 6; round++) {
    let acted = false;
    for (const x of users) {
      const r = await hub(toks.get(x) as string, "GET", "/me/review-tasks?limit=50");
      for (const it of (r.json.items as Json[]) ?? []) {
        const t = it.task as Json;
        if (t.status !== "open" || !t.can_act) continue;
        const st = stages[t.stage_idx as number] as Json;
        const kind = (st.executor as Json).kind as string;
        let res: { status: number; json: Json };
        if (kind === "form") {
          const values: Json = {};
          for (const f of (st.executor as Json).fields as Json[]) {
            const v = sample(f);
            if (v !== undefined) values[f.key as string] = v;
          }
          res = await hub(toks.get(x) as string, "POST", `/review-tasks/${t.id}/form`, { values });
          log(`${x} điền «${t.stage_name}» → ${res.status}`);
        } else if (mode === "loop" && !looped && st.key === "s4-gd") {
          looped = true;
          const back = (st.after as Json).back_to_steps as number[];
          res = await hub(toks.get(x) as string, "POST", `/review-tasks/${t.id}/decision`, {
            result: "fail",
            feedback: "Ngân sách chưa đạt, làm lại bảng so sánh",
            back_to_step: back[0],
          });
          log(`${x} TRẢ LẠI «${t.stage_name}» về bước ${back[0]} → ${res.status}`);
        } else {
          res = await hub(toks.get(x) as string, "POST", `/review-tasks/${t.id}/decision`, {
            result: "pass",
          });
          log(`${x} duyệt «${t.stage_name}» → ${res.status}`);
        }
        if (res.status >= 300) log(`  lỗi ${JSON.stringify(res.json).slice(0, 200)}`);
        else acted = true;
      }
    }
    idle = acted ? 0 : idle + 1;
    if (!acted) await new Promise((r) => setTimeout(r, 2000));
  }
  const ap = await hub(starter, "GET", `/pack/contracts/contracts/${cid}/approval`);
  log(`KẾT: run_status=${String(ap.json.run_status)} step=${String(ap.json.step)} hợp đồng ${cid}`);
  log(
    `các bước: ${JSON.stringify(((ap.json.steps as Json[]) ?? []).map((s) => `${s.name}:${s.status}`))}`,
  );
}

/** Người ký (Giám đốc) bấm «Ký ngay» = POST sign-url rồi mở địa chỉ nhà cung cấp «Ký thử» (selfsign) ⇒ phong bì «đã ký» ⇒ `esign.completed`. */
async function signEsign(cid: string): Promise<void> {
  const tok = await tokenOf(ROLES.gd.user);
  const su = await hub(tok, "POST", `/pack/contracts/contracts/${cid}/esign/sign-url`, {
    return_url: `${u.web}/contracts/c/${cid}`,
    provider: "selfsign",
  });
  log(`sign-url ${su.status} ${JSON.stringify(su.json).slice(0, 200)}`);
  const url = String(su.json.url ?? "");
  if (!url) return;
  const res = await fetch(url, { redirect: "manual", headers: { authorization: `Bearer ${tok}` } });
  log(`mở địa chỉ ký → ${res.status} ${res.headers.get("location") ?? ""}`.slice(0, 200));
  await new Promise((r) => setTimeout(r, 4000));
  const rf = await hub(tok, "POST", `/pack/contracts/contracts/${cid}/esign/refresh`);
  log(`refresh ${rf.status} ${JSON.stringify(rf.json).slice(0, 160)}`);
}

if (mode === "prepare") await prepare();
else {
  await prepare();
  const nv = await tokenOf(ROLES.nv.user);
  // Ký số chỉ nhận PDF (`ESIGN_UNSUPPORTED_FILE` với .md) ⇒ tải PDF tối giản (chữ không dấu); CLI AI giả tự dùng dữ liệu mẫu của `buyContract`.
  const pdf = await PDFDocument.create();
  const pg = pdf.addPage([595, 842]);
  pg.drawText(`HOP DONG MUA HANG ${Date.now().toString(36)} (DEMO)`, { x: 50, y: 780, size: 14 });
  const form = new FormData();
  form.append(
    "file",
    new File([await pdf.save()], "hop-dong-mua.pdf", { type: "application/pdf" }),
  );
  const up = await hub(nv, "POST", "/pack/contracts/contracts", undefined, form);
  log(`upload ${up.status} ${JSON.stringify(up.json).slice(0, 160)}`);
  const cid = String(up.json.id);
  let c: Json = {};
  for (let i = 0; i < 90; i++) {
    c = (await hub(nv, "GET", `/pack/contracts/contracts/${cid}`)).json;
    if (c.status && c.status !== "extracting") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  log(`HĐ ${cid} trạng thái ${String(c.status)} v${String(c.version)}`);
  // cờ flow BẬT: HĐ nháp chờ rà soát ở thẻ `level1`; người tải bấm «Gửi duyệt» = `approve` trên thẻ ⇒ phát `contract.submitted`.
  const rv = await hub(nv, "POST", `/pack/contracts/contracts/${cid}/approval`, {
    action: "approve",
  });
  log(`Gửi duyệt ${rv.status} ${JSON.stringify(rv.json).slice(0, 200)}`);
  await walk(nv, cid);
  await signEsign(cid); // «Ký ngay» (Ký thử) bởi người ký công ty = nhóm Giám đốc
  await walk(nv, cid);
}
