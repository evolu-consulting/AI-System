// CR-123 · u3a · FLOW3-FR-14: node module nhiều stage (Ký số = gửi + chờ ký xong) là MỘT ô ⇒ bấm stage nào cũng mở MỘT panel:
// tên của cả node, cấu hình riêng (người ký, nhà cung cấp, thứ tự, hạn, nhắc — `NodeConfigPanel`), đi tiếp theo kết quả. Stage "chờ"
// của cụm KHÔNG hiện panel chờ sự kiện chung (giờ chờ tự đặt theo hạn ký). Cấu hình ghi vào stage `node.config.stage`.
import { useTranslation } from "react-i18next";
import type { StageDraft } from "../../lib/draft-types";
import type { ModuleCluster } from "../../lib/module-cluster";
import { usePalette } from "../../palette-api";
import { useFlowCtx } from "../flow/flow-ctx";
import { NodeConfigPanel } from "../flow/NodeConfigPanel";
import { TextField } from "./Fields";
import { StageActions } from "./StageActions";
import { StageLinks } from "./StageLinks";
import type { StageFormProps } from "./stage-form-props";

/** Tên các stage của cụm khi đổi tên node: stage đầu = tên, stage sau = "<tên> 2", "<tên> 3"… (như lúc chèn từ menu). */
export const clusterNames = (name: string, size: number): string[] =>
  Array.from({ length: size }, (_, k) => (k === 0 ? name : `${name} ${k + 1}`));

export function StageCluster(p: StageFormProps & { cluster: ModuleCluster }) {
  const { t } = useTranslation();
  const flow = useFlowCtx();
  const palette = usePalette(flow?.app ?? "", flow?.tenantId);
  const { cluster, all, readOnly } = p;
  const members: StageDraft[] = all.slice(cluster.start, cluster.end);
  const head = members[0] as StageDraft;
  const node = palette.data?.find((n) => n.key === cluster.node);
  const cfgIndex = cluster.start + (node?.config?.stage ?? 0);
  const cfg = all[cfgIndex];
  // stage cuối cụm (chờ ký xong) giữ "đi tiếp theo kết quả"
  const lastIndex = cluster.end - 1;
  const last = all[lastIndex];
  const rename = (name: string) => {
    const names = clusterNames(name, members.length);
    flow?.patchStages?.(members.map((s, k) => ({ uid: s.uid, patch: { name: names[k] ?? name } })));
  };
  return (
    <section className="space-y-4 px-1" aria-label={head.name} data-testid="stage-cluster">
      <TextField
        id={`${head.uid}-name`}
        label={t("process.admin.editor.stage.name")}
        value={head.name}
        readOnly={readOnly}
        onChange={rename}
      />
      {node?.config && cfg ? (
        <NodeConfigPanel
          {...p}
          stage={cfg}
          index={cfgIndex}
          node={node}
          onChange={(patch) => flow?.patchStages?.([{ uid: cfg.uid, patch }])}
        />
      ) : (
        <p className="text-caption text-muted-foreground" data-testid="module-note">
          {t("process.admin.flow.moduleNote")}
        </p>
      )}
      {last ? (
        <StageLinks
          {...p}
          stage={last}
          index={lastIndex}
          onChange={(patch) => flow?.patchStages?.([{ uid: last.uid, patch }])}
        />
      ) : null}
      <StageActions {...p} />
    </section>
  );
}
