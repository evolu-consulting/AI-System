// CR-122 · p22 · cổng ra HIỆN của node trên canvas sửa được: kéo từ đây sang node khác để đặt đích ("Sau đó đi tiếp" / Đúng / Sai).
// Chỉ hiện khi sơ đồ cho nối tay (`connectable`); ngược lại node dùng `HiddenHandle` như cũ (cạnh vẫn vẽ được).
import { HiddenHandle } from "@ai/flow-canvas";
import { Handle, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";

type Props = { id?: string; connectable: boolean };

/** Chấm tròn ở mép phải node (bước thường). */
export function NextPort({ connectable }: Props) {
  const { t } = useTranslation();
  if (!connectable) return <HiddenHandle type="source" position={Position.Right} />;
  const label = t("process.admin.canvas.connect.dragNext");
  return (
    <Handle
      type="source"
      position={Position.Right}
      title={label}
      aria-label={label}
      data-testid="port-next"
      style={{
        width: 12,
        height: 12,
        background: "var(--color-card)",
        border: "2px solid var(--color-primary)",
        cursor: "crosshair",
      }}
    />
  );
}

/** Cổng Đúng / Sai của node Nếu: hai nhãn chữ xếp trên/dưới ở mép phải (không chỉ màu). */
export function IfPort({ id, connectable }: Required<Pick<Props, "id">> & Props) {
  const { t } = useTranslation();
  if (!connectable) return <HiddenHandle id={id} type="source" position={Position.Right} />;
  const yes = id === "yes";
  const label = t(yes ? "process.admin.canvas.if.yes" : "process.admin.canvas.if.no");
  return (
    <Handle
      id={id}
      type="source"
      position={Position.Right}
      title={t("process.admin.canvas.connect.dragIf", { label })}
      aria-label={label}
      data-testid={`port-${id}`}
      style={{
        top: yes ? "26%" : "74%",
        width: "auto",
        height: "auto",
        background: "var(--color-card)",
        cursor: "crosshair",
      }}
      className={`rounded-full border px-1.5 text-caption leading-4 ${
        yes ? "border-success text-success" : "border-destructive text-destructive"
      }`}
    >
      <span className="pointer-events-none">{label}</span>
    </Handle>
  );
}
