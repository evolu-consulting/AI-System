// CR-125 · m6a · MOD-FR-07/08: cửa vào panel cấu hình của node — panel riêng theo khoá node (panelRegistry), không có thì panel chung từ `configPort`.
import { configPortOf, type NodePanelProps, panelRegistry } from "../../modules/panel-registry";
import "../../modules/register-panels";
import { GenericPanel } from "../../modules/generic/GenericPanel";

export function NodeConfigPanel(p: NodePanelProps) {
  const Custom = panelRegistry.get(p.node.key);
  if (Custom) return <Custom {...p} />;
  const port = configPortOf(p.node.key);
  return port ? <GenericPanel {...p} port={port} /> : null;
}
