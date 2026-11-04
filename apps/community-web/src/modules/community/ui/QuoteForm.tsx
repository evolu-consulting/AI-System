// CR-102b · C7b · form "Lưu báo giá vào Sản phẩm & Giá" (mockup `.cbox`): điền sẵn từ bài, SP khớp + "Tạo sản phẩm mới", so giá với
// giá đã ghi nhận, cảnh báo lệch > 30% / khác VAT, thông báo thay giá. Chỉ chủ quản thấy (nút chỉ có khi server trả `saveQuote`).
import type { HostHint, PostView, QuotePreview } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { useApp } from "../application/ctx";
import {
  compareText,
  hasErrors,
  prefill,
  type QuoteDraft,
  quoteErrors,
  toQuoteInput,
  warningText,
} from "../domain/quote";
import { numLocale, t } from "../i18n";

type Props = {
  post: PostView;
  supplier: string;
  commentId?: string;
  itemIdx: number;
  onClose: () => void;
  /** Đã lưu: `more` = chủ quản bấm "Lưu thêm báo giá" (mặt hàng kế tiếp). */
  onSaved: (more: boolean) => void;
};

export function QuoteForm({ post, supplier, commentId, itemIdx, onClose, onSaved }: Props) {
  const { api, toast } = useApp();
  const [d, setD] = useState<QuoteDraft>(() =>
    prefill(post, {
      supplier,
      hint: post.hostHint,
      itemIdx,
      ...(commentId ? { commentId } : {}),
    }),
  );
  const [pv, setPv] = useState<QuotePreview | null>(null);
  const [match, setMatch] = useState<HostHint | null>(post.hostHint ?? null);
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const errors = quoteErrors(d);
  const ready = !hasErrors(errors);
  const key = JSON.stringify([d.productId, d.price, d.unit, d.vatIncluded, d.kind]);

  // Xem trước (không ghi): so giá + cảnh báo; chờ ngắn khi đang gõ.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy lại khi các trường ảnh hưởng so giá đổi (key)
  useEffect(() => {
    if (!ready || d.productId === "new") return setPv(null);
    const t = setTimeout(() => {
      api.previewQuote(post.id, toQuoteInput(d)).then(setPv, () => setPv(null));
    }, 250);
    return () => clearTimeout(t);
  }, [key]);

  const search = async () => {
    if (!find.trim()) return;
    const r = await api.matchProduct(find.trim());
    setMatch(r.hint);
    if (r.hint.match)
      setD({ ...d, productId: r.hint.match.productId, unit: r.hint.match.unit ?? d.unit });
  };
  const save = async (more: boolean) => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      const r = await api.saveQuote(post.id, toQuoteInput(d));
      toast(
        r.replaces > 0
          ? t("community.quote.savedReplacedToast", { n: r.replaces })
          : t("community.quote.savedToast"),
      );
      onSaved(more);
    } finally {
      setBusy(false);
    }
  };
  const set = (p: Partial<QuoteDraft>) => setD({ ...d, ...p });
  const m = match?.match ?? null;

  return (
    <div className="cbox" style={{ margin: "12px 16px 0" }} data-testid="quote-form">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <b style={{ flex: 1 }}>{t("community.quote.title")}</b>
        <span className="tag ind sm">{t("community.quote.source")}</span>
      </div>
      {pv?.existing && (
        <div className="impact" role="status">
          {t("community.quote.existing", {
            by: pv.existing.by,
            at: new Date(pv.existing.at).toLocaleString(numLocale()),
          })}
        </div>
      )}
      <div className="form">
        <div>
          <label htmlFor="q-prod">{t("community.quote.product")}</label>
          <select
            id="q-prod"
            className="field"
            value={d.productId}
            onChange={(e) => set({ productId: e.target.value })}
          >
            {m && <option value={m.productId}>{m.name}</option>}
            <option value="new">{t("community.quote.createNew")}</option>
          </select>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input
              className="field"
              aria-label={t("community.quote.findLabel")}
              placeholder={t("community.quote.findPlaceholder")}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && search()}
            />
            <button type="button" className="ghost" onClick={search}>
              {t("community.quote.find")}
            </button>
          </div>
        </div>
        {d.productId === "new" && (
          <div>
            <label htmlFor="q-new">{t("community.quote.newName")}</label>
            <input
              id="q-new"
              className="field"
              value={d.newName}
              onChange={(e) => set({ newName: e.target.value })}
            />
            {errors.product && <div className="err">{errors.product}</div>}
          </div>
        )}
        <div>
          <label htmlFor="q-sup">{t("community.quote.supplier")}</label>
          <input id="q-sup" className="field" value={d.supplier} readOnly />
        </div>
        <div>
          <label htmlFor="q-price">
            {t("community.quote.price", { unit: d.unit || t("community.quote.unitFallback") })}
          </label>
          <input
            id="q-price"
            className="field"
            inputMode="numeric"
            value={d.price}
            onChange={(e) => set({ price: e.target.value })}
          />
          {errors.price && <div className="err">{errors.price}</div>}
        </div>
        <div>
          <label htmlFor="q-unit">{t("community.quote.unit")}</label>
          <input
            id="q-unit"
            className="field"
            value={d.unit}
            onChange={(e) => set({ unit: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="q-vat">VAT</label>
          <select
            id="q-vat"
            className="field"
            value={d.vatIncluded ? "in" : "out"}
            onChange={(e) => set({ vatIncluded: e.target.value === "in" })}
          >
            <option value="in">{t("community.quote.vatIn")}</option>
            <option value="out">{t("community.quote.vatOut")}</option>
          </select>
        </div>
        <div>
          <label htmlFor="q-kind">{t("community.quote.kind")}</label>
          <select
            id="q-kind"
            className="field"
            value={d.kind}
            onChange={(e) => set({ kind: e.target.value as "new" | "renew" })}
          >
            {(["new", "renew"] as const).map((k) => (
              <option key={k} value={k}>
                {t(k === "new" ? "community.quote.kindNew" : "community.quote.kindRenew")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="q-date">{t("community.quote.date")}</label>
          <input
            id="q-date"
            type="date"
            className="field"
            value={d.quotedAt}
            onChange={(e) => set({ quotedAt: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="q-exp">{t("community.quote.expires")}</label>
          <input
            id="q-exp"
            type="date"
            className="field"
            value={d.expiresOn}
            onChange={(e) => set({ expiresOn: e.target.value })}
          />
          {errors.expires && <div className="err">{errors.expires}</div>}
        </div>
      </div>
      <label className="chk" style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          type="checkbox"
          checked={d.notify}
          onChange={(e) => set({ notify: e.target.checked })}
        />
        {t("community.quote.notify")}
      </label>
      {pv && <div className="impact">{compareText(pv.compare)}</div>}
      {pv?.warnings.map((w) => (
        <div className="impact" role="alert" key={w.code} style={{ color: "#8a4306" }}>
          {warningText(w)}
        </div>
      ))}
      {pv && pv.replaces > 0 && (
        <div className="impact">{t("community.quote.replaces", { n: pv.replaces })}</div>
      )}
      <div className="xf">
        <button type="button" className="ghost" onClick={onClose}>
          {t("community.common.cancel")}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!ready || busy}
          onClick={() => save(true)}
        >
          {t("community.quote.saveAndMore")}
        </button>
        <button
          type="button"
          className="primary sm"
          disabled={!ready || busy}
          onClick={() => save(false)}
        >
          {t("community.quote.save")}
        </button>
      </div>
    </div>
  );
}
