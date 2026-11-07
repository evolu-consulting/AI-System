// CR-125 · m6a · MOD-FR-07/08: sổ panel cấu hình theo khoá node. Node có panel riêng (vd `contracts.esign`) đăng ký ở đây;
// node khác dùng panel chung dựng từ `configPort` (generic/). Không import React ở đây ⇒ test thuần.
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { type FeatureModule, MODULES, type PortSchema } from "@ai/contracts/modules";
import type { ComponentType } from "react";
import type { StageFormProps } from "../components/editor/stage-form-props";

export type NodePanelProps = StageFormProps & { node: AppNodeDecl };
export type NodePanel = ComponentType<NodePanelProps>;

const panels = new Map<string, NodePanel>();

export const panelRegistry = {
  register(nodeKey: string, panel: NodePanel): void {
    panels.set(nodeKey, panel);
  },
  get(nodeKey: string): NodePanel | undefined {
    return panels.get(nodeKey);
  },
  has(nodeKey: string): boolean {
    return panels.has(nodeKey);
  },
  /** Chỉ cho test. */
  clear(): void {
    panels.clear();
  },
};

/** Cổng cấu hình khai ở sổ MODULES (m1) của node. */
export function configPortOf(
  nodeKey: string,
  mods: readonly FeatureModule[] = MODULES,
): PortSchema | undefined {
  for (const m of mods) for (const n of m.nodes) if (n.key === nodeKey) return n.configPort;
  return undefined;
}

/** Node có phần cấu hình riêng để hiện (panel riêng, cổng cấu hình, hoặc `config` kiểu cũ của manifest). */
export function hasNodePanel(
  node: AppNodeDecl | undefined,
  mods: readonly FeatureModule[] = MODULES,
): boolean {
  if (!node) return false;
  return panelRegistry.has(node.key) || configPortOf(node.key, mods) !== undefined || !!node.config;
}
