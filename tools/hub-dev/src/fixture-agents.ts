// HUB-FR-101 · HUB-FR-103 · CR-051: seed dev agent demo cho tenant `evolu` — `consultant` (Evolu Consultant, sẽ là agent
// mặc định ở "Hỏi AI" khi có CR-053) + `invoices` (kiểm tra hoá đơn FPT/MISA trên trang tra cứu chính chủ). Cấp cho mọi
// user evolu. Profile lấy theo agent `assistant` (có từ `hub:seed` ⇒ chạy SAU seed). E2E dùng stack/seed riêng (không
// dùng file này). Ghi bằng owner DB. Idempotent: `ON CONFLICT DO NOTHING`; chỉ tăng `hub_config_version` khi có grant mới.
import postgres from "postgres";
import { DEMO_TENANT, DEMO_USERS } from "./fixture";

const CONSULTANT_PROMPT = `Bạn là Evolu Consultant — trợ lý tư vấn của công ty Evolu, trả lời bằng tiếng Việt (hoặc theo
ngôn ngữ người hỏi), ngắn gọn, có cấu trúc. Giúp nhân viên Evolu về tư vấn doanh nghiệp, quy trình, tài liệu và câu hỏi
chung. Không bịa số liệu; thiếu thông tin thì hỏi lại. Việc chuyên môn có agent riêng (vd kiểm tra hoá đơn: @invoices)
thì gợi ý người dùng gọi agent đó.`;

const INVOICES_PROMPT = `Bạn là Invoices — agent kiểm tra hoá đơn điện tử do FPT (FPT.eInvoice) và MISA (meInvoice) phát
hành. Chỉ tra cứu trên trang tra cứu CHÍNH CHỦ của nhà cung cấp phát hành hoá đơn (FPT hoặc MISA) hoặc cổng hoá đơn điện tử
của Tổng cục Thuế; KHÔNG dùng trang trung gian/bên thứ ba (vd chungtuhoadon). Hỏi đủ dữ liệu cần để tra (mã tra cứu, mã số
thuế người bán, ký hiệu/số hoá đơn, ngày) nếu người dùng chưa đưa. Kết quả: hoá đơn có tồn tại/hợp lệ không, thông tin
khớp/lệch (người bán, người mua, tổng tiền, thuế), nguồn đã tra (trang nào). Không đoán khi không tra được — nói rõ lý do.`;

const AGENTS = [
  {
    key: "consultant",
    name: "Evolu Consultant",
    description: "Tư vấn chung cho nhân viên Evolu (agent dự phòng khi Orchestrator không khớp).",
    system_prompt: CONSULTANT_PROMPT,
    model: "sonnet",
  },
  {
    key: "invoices",
    name: "Invoices",
    description: "Kiểm tra hoá đơn điện tử FPT, MISA trên trang tra cứu chính chủ.",
    system_prompt: INVOICES_PROMPT,
    model: "sonnet",
  },
];
const KEYS = AGENTS.map((a) => a.key);
/** agent → người được cấp (user): mọi user demo evolu. */
export const AGENT_GRANTS: Record<string, string[]> = Object.fromEntries(
  KEYS.map((k) => [k, DEMO_USERS.map((u) => u.username)]),
);

/**
 * CR-054 · evolu: bật Orchestrator cho công ty (cả công ty dùng được) + agent mặc định = Orchestrator, không khớp → giao
 * Evolu Consultant. Chỉ tạo khi chưa có (không ghi đè lựa chọn ở Evolu Control). Trả true khi có ghi.
 */
async function ensureDefaults(tx: postgres.TransactionSql, tid: string): Promise<boolean> {
  const [orch] = await tx<{ id: string }[]>`select agent_id as id from hub.orchestrator_settings
    where tenant_id is null`;
  const [fb] = await tx<{ id: string }[]>`select id from hub.agents where key = 'consultant'`;
  if (!orch || !fb) return false;
  const ent =
    await tx`insert into hub.agent_entitlements (agent_id, tenant_id) values (${orch.id}, ${tid})
    on conflict do nothing returning 1`;
  const def =
    await tx`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, fallback_agent_id, on_no_match)
    values (${tid}, ${orch.id}, ${fb.id}, 'fallback') on conflict do nothing returning 1`;
  return ent.length + def.length > 0;
}

/** Trả false nếu chưa có tenant `evolu` hoặc chưa có profile (chưa `hub:seed`). */
export async function ensureRoomAgents(ownerUrl: string): Promise<boolean> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const users = await tx<{ tid: string; id: string; username: string }[]>`
        select t.id as tid, u.id, u.username from admin.tenants t join admin.users u on u.tenant_id = t.id
        where t.key = ${DEMO_TENANT.key}`;
      const tid = users[0]?.tid;
      const [base] = await tx<{ profile_id: string }[]>`
        select profile_id from hub.agents where key = 'assistant'`;
      if (!tid || !base) return false;
      await tx`insert into hub.agents ${tx(
        AGENTS.map((a) => ({
          key: a.key,
          name: tx.json({ vi: a.name, en: a.name }),
          description: a.description,
          runtime: "agentic-cli",
          profile_id: base.profile_id,
          system_prompt: a.system_prompt,
          model: a.model,
        })),
      )} on conflict (key) do nothing`;
      // CR-054 · model theo agent (alias CLI): chỉ đặt khi còn trống — không ghi đè lựa chọn ở Agent Forge.
      for (const a of AGENTS)
        await tx`update hub.agents set model = ${a.model} where key = ${a.key} and model is null`;
      await tx`update hub.agents set model = 'haiku' where key = 'orchestrator' and model is null`;
      const ag = await tx<{ id: string; key: string }[]>`
        select id, key from hub.agents where key in ${tx(KEYS)}`;
      await tx`insert into hub.agent_entitlements ${tx(ag.map((a) => ({ agent_id: a.id, tenant_id: tid })))}
        on conflict do nothing`;
      const grants = ag.flatMap((a) =>
        (AGENT_GRANTS[a.key] ?? []).flatMap((name) => {
          const u = users.find((x) => x.username === name);
          return u
            ? [{ agent_id: a.id, tenant_id: tid, subject_type: "user", subject_id: u.id }]
            : [];
        }),
      );
      const ins =
        await tx`insert into hub.agent_grants ${tx(grants)} on conflict do nothing returning 1`;
      const def = await ensureDefaults(tx, tid);
      if (ins.length > 0 || def)
        await tx`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      return true;
    });
  } finally {
    await sql.end();
  }
}
