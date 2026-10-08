// HUB-FR-101 · HUB-FR-103 · seed dev agent phòng X2b (tasks B7): `hoadon` + `trello` cho tenant demo `evolu`.
// Quyền (khớp e2e `_x2b-stack.ts`): A=julian.bui (hoadon, trello) · B=thomas.tran (chỉ trello) · C=vio.ngo (chỉ hoadon)
// ⇒ AC17: B không thấy/gọi được `hoadon`, C thấy. Profile lấy theo agent `assistant` (có từ `hub:seed` ⇒ chạy SAU seed).
// Ghi bằng owner DB. Idempotent: `ON CONFLICT DO NOTHING`; chỉ tăng `hub_config_version` khi có grant mới.
import postgres from "postgres";

const TENANT_KEY = "evolu";
const AGENTS = [
  { key: "hoadon", name: "hoadon", description: "Kiểm tra hoá đơn đầu vào." },
  { key: "trello", name: "Trello", description: "Tạo và cập nhật thẻ Trello của nhóm." },
];
/** agent → người được cấp (user). */
export const AGENT_GRANTS: Record<string, string[]> = {
  hoadon: ["julian.bui", "vio.ngo"],
  trello: ["julian.bui", "thomas.tran"],
};

/** Trả false nếu chưa có tenant `evolu` hoặc chưa có profile (chưa `hub:seed`). */
export async function ensureRoomAgents(ownerUrl: string): Promise<boolean> {
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const users = await tx<{ tid: string; id: string; username: string }[]>`
        select t.id as tid, u.id, u.username from admin.tenants t join admin.users u on u.tenant_id = t.id
        where t.key = ${TENANT_KEY}`;
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
          system_prompt: "",
        })),
      )} on conflict (key) do nothing`;
      const ag = await tx<{ id: string; key: string }[]>`
        select id, key from hub.agents where key in ('hoadon', 'trello')`;
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
      if (ins.length > 0)
        await tx`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
      return true;
    });
  } finally {
    await sql.end();
  }
}
