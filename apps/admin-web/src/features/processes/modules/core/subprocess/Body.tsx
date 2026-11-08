// CR-125 · cr125-subprocess-ui · thân ô "Quy trình con" trên canvas: tên bước, huy hiệu "quy trình con", tên quy trình con + số bước, liên kết "Mở quy trình con".
// Ô nằm trong nút bấm của canvas ⇒ liên kết là `span role="link"` (không lồng <a> trong <button>), bấm không chọn ô.
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StageView } from "../../../components/canvas/stage-view";
import { childEditorLink } from "../../../lib/subprocess-form";
import { useChild } from "./use-child";

const K = "process.admin.subprocess.";

export function SubprocessBody({ v }: { v: StageView }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const defKey = v.src.subprocess?.defKey ?? "";
  const { item, tenantId } = useChild(defKey);
  const name = v.name || t("process.admin.editor.stage.unnamed");
  const open = () => void navigate(childEditorLink(item?.id ?? "", tenantId));
  return (
    <span className="block min-w-0 text-left" data-testid="subprocess-node">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="block truncate text-label font-medium" title={name}>
          {name}
        </span>
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary px-1.5 text-caption leading-4 text-primary"
          data-testid="subprocess-badge"
        >
          <Workflow aria-hidden className="size-3" />
          {t(`${K}badge`)}
        </span>
      </span>
      {defKey === "" ? (
        <span
          className="flex items-start gap-1 text-caption text-warning"
          data-testid="subprocess-empty"
        >
          <CircleAlert aria-hidden className="size-3 shrink-0" />
          {t(`${K}notPicked`)}
        </span>
      ) : (
        <span
          className="block truncate text-caption text-muted-foreground"
          title={item?.name ?? defKey}
          data-testid="subprocess-child"
        >
          {item ? `${item.name} · ${t(`${K}steps`, { count: item.stage_count })}` : defKey}
        </span>
      )}
      {item ? (
        // biome-ignore lint/a11y/useSemanticElements: nằm trong <button> của ô canvas — không lồng <a>
        <span
          role="link"
          tabIndex={0}
          className="block truncate text-caption text-primary underline-offset-2 hover:underline"
          data-testid="subprocess-open"
          onClick={(e) => {
            e.stopPropagation();
            open();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.stopPropagation();
              e.preventDefault();
              open();
            }
          }}
        >
          {t(`${K}open`)}
        </span>
      ) : null}
    </span>
  );
}
