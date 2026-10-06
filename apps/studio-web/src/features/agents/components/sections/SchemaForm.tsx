// HUB-FR-61 · H4a-D9 · SchemaForm: dựng ô nhập từ `config_schema` của agent type (renderer tự viết, không rjsf).
// Giá trị là `runtime_options` của agent `python`; kiểu ngoài danh sách ⇒ textarea JSON, chỉ ghi khi `JSON.parse` được; ô đang sai báo `onBad` ⇒ `draft.badJson` chặn Lưu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import {
  buildFields,
  getAt,
  parseJson,
  parseNum,
  type SField,
  setAt,
} from "../../lib/draft/schema-form";

type Opts = Record<string, unknown>;
/** `onBad(id, bad)`: ô JSON thô `id` đang sai/đúng — đẩy lên nháp để chặn Lưu. */
type Props = {
  schema: Opts;
  value: Opts;
  onChange: (v: Opts) => void;
  onBad: (id: string, bad: boolean) => void;
};
type BoxProps = {
  id: string;
  label: string;
  value: unknown;
  onValue: (v: unknown) => void;
  onBad: Props["onBad"];
};

function JsonBox(p: BoxProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(p.value === undefined ? "" : JSON.stringify(p.value, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={p.id}>{p.label}</Label>
      <Textarea
        id={p.id}
        className="font-mono"
        value={text}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${p.id}-err` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          const r = parseJson(e.target.value);
          setBad(!r.ok);
          p.onBad(p.id, !r.ok);
          if (r.ok) p.onValue(r.value);
        }}
      />
      {bad ? (
        <p id={`${p.id}-err`} role="alert" className="text-label text-danger">
          {t("editor.err.json")}
        </p>
      ) : null}
    </div>
  );
}

function Leaf({
  f,
  path,
  value,
  onChange,
  onBad,
}: { f: SField; path: string[] } & Omit<Props, "schema">) {
  const id = `sf-${path.join("-")}`;
  const label = f.required ? `${f.name} *` : f.name;
  const cur = getAt(value, path);
  const set = (v: unknown) => onChange(setAt(value, path, v));
  if (f.kind === "json")
    return <JsonBox id={id} label={label} value={cur} onValue={set} onBad={onBad} />;
  if (f.kind === "boolean")
    return (
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={cur === true} onCheckedChange={(v) => set(v === true)} />
        <Label htmlFor={id}>{label}</Label>
      </div>
    );
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {f.kind === "enum" ? (
        <Select value={typeof cur === "string" ? cur : ""} onValueChange={set}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {f.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={f.kind === "string" ? "text" : "number"}
          value={cur === undefined ? "" : String(cur)}
          onChange={(e) => {
            if (f.kind === "string") return set(e.target.value === "" ? undefined : e.target.value);
            const n = parseNum(e.target.value, f.kind === "integer");
            if (n !== null) set(n);
          }}
        />
      )}
      {f.description ? <p className="text-label text-muted-foreground">{f.description}</p> : null}
    </div>
  );
}

function Node(p: { f: SField; path: string[] } & Omit<Props, "schema">) {
  if (p.f.kind !== "object") return <Leaf {...p} />;
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-label font-medium">{p.f.name}</legend>
      {p.f.children.map((c) => (
        <Leaf
          key={c.name}
          f={c}
          path={[...p.path, c.name]}
          value={p.value}
          onChange={p.onChange}
          onBad={p.onBad}
        />
      ))}
    </fieldset>
  );
}

export function SchemaForm({ schema, value, onChange, onBad }: Props) {
  const { t } = useTranslation();
  const fields = buildFields(schema);
  return (
    <div className="space-y-4">
      {fields.length > 0 ? (
        <p className="text-label font-medium">{t("editor.field.agentConfig")}</p>
      ) : null}
      {fields.length === 0 ? (
        <JsonBox
          id="sf-raw"
          label={t("editor.field.agentConfig")}
          value={Object.keys(value).length === 0 ? undefined : value}
          onBad={onBad}
          onValue={(v) => {
            if (v === undefined) onChange({});
            else if (typeof v === "object" && v !== null && !Array.isArray(v)) onChange(v as Opts);
          }}
        />
      ) : (
        fields.map((f) => (
          <Node
            key={f.name}
            f={f}
            path={[f.name]}
            value={value}
            onChange={onChange}
            onBad={onBad}
          />
        ))
      )}
    </div>
  );
}
