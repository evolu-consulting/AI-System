// CR-118 · cr118-feature-gate-web · provider OpenFeature mỏng trên ảnh `/pack/me` (`flags` phẳng: `<pack>` / `<pack>.<action>` / add-on).
// Có ảnh mà thiếu khoá ⇒ tắt (fail-closed UI; server mới là nguồn thật); chưa có ảnh ⇒ giá trị mặc định của chỗ gọi.
import {
  ErrorCode,
  type JsonValue,
  OpenFeatureEventEmitter,
  type Provider,
  ProviderEvents,
  type ResolutionDetails,
  StandardResolutionReasons,
} from "@openfeature/web-sdk";
import type { PackMeSource } from "./pack-me-source";

const wrongType = <T>(value: T): ResolutionDetails<T> => ({
  value,
  reason: StandardResolutionReasons.ERROR,
  errorCode: ErrorCode.TYPE_MISMATCH,
  errorMessage: "Chỉ hỗ trợ cờ boolean",
});

export function createPackMeProvider(source: PackMeSource): Provider {
  const events = new OpenFeatureEventEmitter();
  // Đăng ký một lần (singleton cùng vòng đời nguồn): ảnh đổi ⇒ báo mọi hook React tính lại.
  source.subscribe((d) =>
    events.emit(ProviderEvents.ConfigurationChanged, { flagsChanged: Object.keys(d.flags) }),
  );
  return {
    metadata: { name: "pack-me" },
    runsOn: "client",
    events,
    async initialize() {
      await source.refresh().catch(() => {});
    },
    resolveBooleanEvaluation(flagKey, defaultValue): ResolutionDetails<boolean> {
      const snap = source.snapshot();
      if (!snap) return { value: defaultValue, reason: StandardResolutionReasons.DEFAULT };
      return { value: snap.flags[flagKey] === true, reason: StandardResolutionReasons.STATIC };
    },
    resolveStringEvaluation: (_k, d) => wrongType(d),
    resolveNumberEvaluation: (_k, d) => wrongType(d),
    resolveObjectEvaluation: <T extends JsonValue>(_k: string, d: T) => wrongType(d),
  };
}
