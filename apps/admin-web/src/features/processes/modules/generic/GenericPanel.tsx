// CR-125 · m6a · MOD-FR-07: panel chung dựng từ `configPort` của node. Dùng lại ô nhập của editor (TextField/SelectField);
// người/phòng ban lấy từ `refs`; lỗi lưu hiện cạnh ô (`stages.<i>.executor.args.<khoá>`). Cấu hình ghi vào args hằng của stage tool.
import type { PortSchema } from "@ai/contracts/modules";
import { useTranslation } from "react-i18next";
import { SelectField, TextField } from "../../components/editor/Fields";
import { constArgs, withConfigArgs } from "../../lib/node-config";
import type { NodePanelProps } from "../panel-registry";
import { fieldsOf, type PanelField, toArg } from "./fields";

const DEFAULT = "default";
const K = "process.admin.flow.esign.";

const INPUT_TYPE: Partial<Record<PanelField["kind"], "number" | "date">> = {
  number: "number",
  date: "date",
};

type Choice = { value: string; label: string };

/** Ô chọn từ danh sách ⇒ các lựa chọn; ô gõ ⇒ undefined. (Nhiều người: chọn một, nhiều lựa chọn ở lát sau.) */
function choicesOf(
  f: PanelField,
  refs: NodePanelProps["refs"],
  t: (k: string, o?: { defaultValue: string }) => string,
): Choice[] | undefined {
  if (f.kind === "person" || f.kind === "people") return refs.users;
  if (f.kind === "department") return refs.groups;
  if (f.kind === "bool")
    return [
      { value: "true", label: t(`${K}yes`) },
      { value: "false", label: t(`${K}no`) },
    ];
  if (f.kind === "enum")
    return (f.options ?? []).map((o) => ({
      value: o,
      label: t(`process.admin.module.enum.${o}`, { defaultValue: o }),
    }));
  return undefined;
}

export function GenericPanel(p: NodePanelProps & { port: PortSchema }) {
  const { t } = useTranslation();
  const { stage, readOnly, refs } = p;
  const fields = fieldsOf(p.port);
  const keys = fields.map((f) => f.key);
  const cur = constArgs(stage.tool, keys);
  const set = (f: PanelField, raw: string) => {
    const next: Record<string, string | number | boolean> = { ...cur };
    const v = toArg(f, raw);
    if (v === undefined) delete next[f.key];
    else next[f.key] = v;
    p.onChange({ tool: withConfigArgs(stage.tool, keys, next) });
  };
  const dflt = t(`${K}default`);
  const err = (k: string) => {
    const e = p.errors[`stages.${p.index}.executor.args.${k}`];
    return e ? t(e) : undefined;
  };
  return (
    <fieldset className="grid grid-cols-2 items-start gap-3" data-testid="node-config-generic">
      {fields.map((f) => {
        const id = `${stage.uid}-${f.key}`;
        const common = { id, label: f.label, error: err(f.key), readOnly };
        const v = cur[f.key];
        const options = choicesOf(f, refs, t);
        if (options)
          return (
            <div key={f.key}>
              <SelectField
                {...common}
                value={v === undefined ? DEFAULT : String(v)}
                options={[{ value: DEFAULT, label: dflt }, ...options]}
                onChange={(x) => set(f, x === DEFAULT ? "" : x)}
              />
            </div>
          );
        return (
          <div key={f.key} className={f.kind === "longtext" ? "col-span-2" : undefined}>
            <TextField
              {...common}
              type={INPUT_TYPE[f.kind] ?? "text"}
              multiline={f.kind === "longtext"}
              value={v === undefined ? "" : String(v)}
              placeholder={f.required ? undefined : dflt}
              onChange={(x) => set(f, x)}
            />
          </div>
        );
      })}
    </fieldset>
  );
}
