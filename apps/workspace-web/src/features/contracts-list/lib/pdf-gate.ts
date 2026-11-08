// CR-125 · UX H6 · công ty đã bật ký số ⇒ chỉ nhận tệp PDF khi tải lên (HĐ không phải PDF đi hết vòng duyệt rồi đứng im ở bước Ký số
// "Chỉ gửi ký được khi … có tệp PDF"). Kiểm ngay lúc chọn tệp, nói rõ cách khắc phục. Thuần.
export const isPdfFile = (f: Pick<File, "name" | "type">): boolean =>
  f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export function splitForEsign<F extends Pick<File, "name" | "type">>(
  files: readonly F[],
  esignOn: boolean,
): { ok: F[]; notPdf: string[] } {
  if (!esignOn) return { ok: [...files], notPdf: [] };
  return {
    ok: files.filter(isPdfFile),
    notPdf: files.filter((f) => !isPdfFile(f)).map((f) => f.name),
  };
}
