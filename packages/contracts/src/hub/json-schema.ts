// HUB-FR-89 · gói JSON Schema của HUB_JSON_SCHEMAS cho C2 (`contracts:gen`): một tài liệu, mỗi key = một `$defs`.
import { z } from "zod";
import { HUB_JSON_SCHEMAS } from "./export";

/** Draft 2020-12, `io: "output"`, ném khi có kiểu không biểu diễn được; key sắp theo thứ tự khai báo. */
export function hubJsonSchemaBundle(): Record<string, unknown> {
  const reg = z.registry<{ id: string }>();
  for (const [id, s] of Object.entries(HUB_JSON_SCHEMAS)) reg.add(s as z.ZodType, { id });
  const out = z.toJSONSchema(reg, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "throw",
    uri: (id) => `#/$defs/${id}`,
  });
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $defs: out.schemas,
  };
}
