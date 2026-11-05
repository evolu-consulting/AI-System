// CR-118 · cr118-feature-gate-web · cổng duy nhất của `platform/features` (luật depcruise web-features-port-only).
export { featureAppsSource, featureFlag, featureHomeSource, reportForbidden } from "./gate";
export { FeatureGate, FeatureRoot, useCan, useFeature, useFeatures } from "./ui/FeatureGate";
