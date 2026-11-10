// Từ flow[] sinh khung Delta (định dạng OpenSpec của repo) để dán vào tasks.md.
import type { Prototype } from "./schema";

const lowerFirst = (s: string): string => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

export function scenarioSkeleton(p: Prototype, file = "<tệp spec mới>.md"): string {
  const title = new Map(p.screens.map((s) => [s.id, s.title]));
  const role = new Map(p.roles.map((r) => [r.key, r.label]));
  const groups = new Map<string, string[]>();
  for (const f of p.flow) {
    const name = title.get(f.from) ?? f.from;
    const line = `- Kịch bản: khi ${role.get(f.by) ?? f.by} ${lowerFirst(f.action)} thì «${title.get(f.to) ?? f.to}» [test: thủ công — chưa viết]`;
    groups.set(name, [...(groups.get(name) ?? []), line]);
  }
  const body = [...groups].map(([name, lines]) => `#### Yêu cầu: ${name}\n${lines.join("\n")}`);
  return [`### ADDED ${file}`, ...body, ""].join("\n");
}
