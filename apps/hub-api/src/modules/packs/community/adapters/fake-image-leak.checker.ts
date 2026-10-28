// COM-C11a · adapter giả cho test các lát C3/C5: trả kết quả đặt trước theo (mặc định clean), ghi lại lời gọi.
import type { ImageInput, ImageLeakChecker } from "../application/image-leak.port";
import type { ImageCheckContext, ImageCheckResult } from "../domain/image-check.rules";

export function fakeImageLeakChecker(
  result: ImageCheckResult | ((i: ImageInput) => ImageCheckResult) = {
    status: "clean",
    findings: [],
  },
): ImageLeakChecker & { calls: { image: ImageInput; ctx?: ImageCheckContext }[] } {
  const calls: { image: ImageInput; ctx?: ImageCheckContext }[] = [];
  return {
    calls,
    async check(image, ctx) {
      calls.push(ctx ? { image, ctx } : { image });
      return typeof result === "function" ? result(image) : result;
    },
  };
}
