// CR-118 · cr118-feature-gate-web · Shell trong vùng cờ tính năng (OpenFeature). Chunk riêng, nạp sau khi cổng gói qua.
import { Shell } from "~/features/shell/pages/Shell";
import { FeatureRoot } from "~/platform/features";

export default function ShellFeatured(props: Parameters<typeof Shell>[0]) {
  return (
    <FeatureRoot>
      <Shell {...props} />
    </FeatureRoot>
  );
}
