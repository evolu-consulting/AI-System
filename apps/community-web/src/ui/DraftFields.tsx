// Trường theo loại bài (mockup `.cfields`): Cần bán = hàng hoá, số lượng, giá/liên hệ; Cần mua = + khu vực, ngày cần.
import type { Draft } from "../lib/compose";

function F({
  label,
  err,
  children,
}: {
  label: string;
  err?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="fgroup">
      {children}
      {err && (
        <div className="ferr" role="alert">
          {err}
        </div>
      )}
      <span style={{ position: "absolute", left: -9999 }}>{label}</span>
    </div>
  );
}

export function DraftFields({
  draft,
  set,
  errors,
  cats,
}: {
  draft: Draft;
  set: (d: Draft) => void;
  errors: Record<string, string>;
  cats?: string[];
}) {
  const on = (k: keyof Draft) => (e: { target: { value: string } }) =>
    set({ ...draft, [k]: e.target.value });
  const buy = draft.type === "buy";
  return (
    <>
      <div className="cfields">
        <F label="Hàng hoá" err={errors.product}>
          <input
            className="field"
            aria-label="Hàng hoá"
            placeholder="Hàng hoá"
            value={draft.product}
            onChange={on("product")}
          />
        </F>
        <F label="Số lượng" err={errors.qty}>
          <input
            className="field"
            aria-label="Số lượng"
            placeholder="Số lượng"
            value={draft.qty}
            onChange={on("qty")}
          />
        </F>
        <F label="Giá" err={errors.price}>
          {buy ? (
            <input
              className="field"
              aria-label="Ngân sách"
              placeholder="Ngân sách (có thể bỏ trống)"
              value={draft.budget}
              onChange={on("budget")}
            />
          ) : (
            <input
              className="field"
              aria-label="Giá"
              placeholder="Giá (bỏ trống = Liên hệ)"
              value={draft.price}
              onChange={on("price")}
            />
          )}
        </F>
      </div>
      <div className="cfields">
        <F label="Khu vực" err={errors.area}>
          <input
            className="field"
            aria-label="Khu vực"
            placeholder={buy ? "Khu vực (bắt buộc)" : "Khu vực"}
            value={draft.area}
            onChange={on("area")}
          />
        </F>
        {buy && (
          <F label="Ngày cần" err={errors.neededBy}>
            <input
              className="field"
              type="date"
              aria-label="Ngày cần"
              value={draft.neededBy}
              onChange={on("neededBy")}
            />
          </F>
        )}
        {cats && cats.length > 0 && (
          <F label="Nhóm hàng">
            <select
              className="field"
              aria-label="Nhóm hàng"
              value={draft.cats[0] ?? ""}
              onChange={(e) => set({ ...draft, cats: e.target.value ? [e.target.value] : [] })}
            >
              <option value="">Nhóm hàng…</option>
              {cats.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </F>
        )}
      </div>
    </>
  );
}
