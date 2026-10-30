// CR-105 · L3: ô chọn phòng ban THEO MÃ (`pb-ke-toan`…) cho Form quy trình thư viện — gõ mã, gợi ý từ danh mục khe nếu Hub trả
// (`GET /process-slots` → `group_keys`; khe hở hợp đồng). Quy trình thư viện không có id phòng ban (design §1).
import { FormField } from "@/components/shared/form/FormField";
import { Input } from "@/components/ui/input";

type Props = {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  options: readonly { key: string; label?: string }[];
  error?: string | undefined;
  placeholder?: string;
};

export function GroupKeyField({ id, label, value, onChange, options, error, placeholder }: Props) {
  const list = `${id}-list`;
  return (
    <FormField id={id} label={label} error={error}>
      {(c) => (
        <>
          <Input
            {...c}
            list={list}
            className="font-mono"
            placeholder={placeholder}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value.trim() === "" ? null : e.target.value.trim())}
          />
          <datalist id={list}>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label ?? o.key}
              </option>
            ))}
          </datalist>
        </>
      )}
    </FormField>
  );
}
