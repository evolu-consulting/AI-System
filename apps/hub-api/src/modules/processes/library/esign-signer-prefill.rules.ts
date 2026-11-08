// CR-125 · S3 · C3: bản sao từ Thư viện luôn thiếu người ký (bước Ký số không còn "người bắt đầu lượt" ngầm) ⇒ công ty nào cũng vấp
// "Lưu và áp dụng" lần đầu. Điền sẵn người ký phía công ty = nhóm duyệt đã gắn (sau khi map mã → id, alias c5b: `<app>-admin` ⇒ `<app>-owner`),
// tức nhóm Giám đốc/chủ gói. Luật THUẦN; chỉ điền khi ô đang trống (không đè lựa chọn có sẵn); không có nhóm ⇒ để trống để người dùng chọn.
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Nhóm duyệt đầu tiên (đã là id) của các bước — theo thứ tự bước. */
export function firstApprovalGroupId(stages: readonly unknown[]): string | null {
  for (const s of stages) {
    if (!isObj(s) || !isObj(s.after)) continue;
    if (typeof s.after.group_id === "string" && s.after.group_id !== "") return s.after.group_id;
  }
  return null;
}

const isEsignSend = (s: unknown): s is Obj & { executor: Obj } =>
  isObj(s) && isObj(s.executor) && s.executor.tool_key === "contracts-esign-send";

export function prefillEsignSigner(stages: readonly unknown[]): unknown[] {
  const gid = firstApprovalGroupId(stages);
  if (!gid) return [...stages];
  return stages.map((s) => {
    if (!isEsignSend(s)) return s;
    const args = isObj(s.executor.args) ? s.executor.args : {};
    const cur = args.company_signers;
    const val = isObj(cur) ? cur.value : cur; // args của stage tool là tham chiếu `{ from: "const", value }`
    if (typeof val === "string" && val.trim() !== "") return s;
    return {
      ...s,
      executor: {
        ...s.executor,
        args: { ...args, company_signers: { from: "const", value: `group:${gid}` } },
      },
    };
  });
}
