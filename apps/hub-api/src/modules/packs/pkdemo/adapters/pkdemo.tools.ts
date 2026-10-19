// N2-FR-03 · N2-D02 · tool mẫu của gói `pkdemo` (gói kiểm thử, chỉ ngoài production): ghi một item trong tx gói của tenant
// gọi (RLS `pkdemo_rw`, danh tính người gọi). `pkdemo-touch` không side_effect; `pkdemo-mark` side_effect (chỉ stage
// `real_action` sau duyệt — D2-49). Kết quả = `{item_id, title}` (= `output.fields` của stage).
import type { PackToolDef } from "../../kit/application/pack-tools.ports";
import type { PackUow } from "../../kit/application/ports";
import type { PkdemoRepos } from "../application/ports";

const PARAMS = [{ name: "title", type: "text", required: true, description: "Tiêu đề" }] as const;

export function pkdemoTools(uow: PackUow<PkdemoRepos>, newId: () => string): PackToolDef[] {
  const run: PackToolDef["run"] = async (ctx, args) => {
    const title = String(args.title ?? "").slice(0, 200);
    if (title === "") throw new Error("title required");
    const id = newId();
    await uow.tenant({ tenantId: ctx.tenantId, userId: ctx.userId }, (r) =>
      r.items.insert({ id, title, lines: [] }),
    );
    return { item_id: id, title };
  };
  // Security M2 · cả hai tool GHI item ⇒ cần quyền `write` của gói (người gọi `/mcp` / người bắt đầu run).
  const base = { pack: "pkdemo", params: PARAMS, run, action: "write" as const };
  return [
    {
      ...base,
      name: "pkdemo-touch",
      description: "Ghi một mục pkdemo (thử nghiệm N2).",
      side_effect: false,
    },
    {
      ...base,
      name: "pkdemo-mark",
      description: "Ghi một mục pkdemo — hành động thật.",
      side_effect: true,
    },
  ];
}
