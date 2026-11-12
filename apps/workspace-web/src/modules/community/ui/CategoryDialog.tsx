// Chọn nhiều nhóm hàng trong hộp thoại (CR-129 L4): trên trang chỉ có một nút tóm tắt «A, B +N»; Xong mới ghi lựa chọn, Huỷ bỏ.
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { useApp } from "../application/ctx";
import { catsSummary, filterCats, toggleCat } from "../domain/cat-pick";
import { t } from "../i18n";

export function CategoryDialog({
  cats,
  value,
  onChange,
}: {
  cats: string[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { brandAccent } = useApp();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<string[]>(value);
  const [q, setQ] = useState("");
  const shown = filterCats(cats, q);
  const openDialog = () => {
    setSel(value);
    setQ("");
    setOpen(true);
  };
  return (
    <>
      <button
        type="button"
        className="ghost catpick"
        data-testid="cat-pick-btn"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        <span className="catpick-txt">
          {catsSummary(value) || t("community.audience.catsPick")}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]" aria-describedby={undefined}>
          <div data-mod="community" data-accent={brandAccent} className="catdlg">
            <DialogHeader>
              <DialogTitle>{t("community.audience.catsTitle")}</DialogTitle>
            </DialogHeader>
            <input
              type="search"
              className="field"
              aria-label={t("community.audience.catsSearch")}
              placeholder={t("community.audience.catsSearch")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <ul className="catlist" data-testid="cat-list">
              {shown.map((c) => (
                <li key={c}>
                  <label className="catrow">
                    <input
                      type="checkbox"
                      checked={sel.includes(c)}
                      onChange={() => setSel(toggleCat(sel, c))}
                    />
                    <span>{c}</span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="meta">{t("community.audience.catsEmpty")}</li>}
            </ul>
            <div className="catfoot">
              <span className="meta">{t("community.audience.catsCount", { n: sel.length })}</span>
              <div className="sp" />
              <button type="button" className="ghost" onClick={() => setOpen(false)}>
                {t("community.audience.catsCancel")}
              </button>
              <button
                type="button"
                className="primary sm"
                data-testid="cat-pick-done"
                onClick={() => {
                  onChange(sel);
                  setOpen(false);
                }}
              >
                {t("community.audience.catsDone")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
