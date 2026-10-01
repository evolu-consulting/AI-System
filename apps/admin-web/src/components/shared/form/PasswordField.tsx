// ADM-FR-01, ADM-FR-03 · ô mật khẩu + nút Hiện/Ẩn (`aria-pressed`). `revealed` điều khiển từ ngoài khi một nút dùng cho nhiều ô.
import { Eye, EyeOff } from "lucide-react";
import { type ComponentPropsWithoutRef, forwardRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";

type Props = Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  revealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
  /** Ẩn nút (ô thứ hai dùng chung nút với ô đầu). */
  hideToggle?: boolean;
};

export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { revealed, onRevealedChange, hideToggle, className, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const [inner, setInner] = useState(false);
  const shown = revealed ?? inner;
  const toggle = () => {
    onRevealedChange?.(!shown);
    if (revealed === undefined) setInner(!shown);
  };
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={shown ? "text" : "password"}
        autoCapitalize="none"
        spellCheck={false}
        className={hideToggle ? className : `pr-10 ${className ?? ""}`}
        {...rest}
      />
      {hideToggle ? null : (
        <button
          type="button"
          aria-pressed={shown}
          aria-label={shown ? t("password.field.hide") : t("password.field.show")}
          onClick={toggle}
          className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {shown ? (
            <EyeOff aria-hidden className="size-4" />
          ) : (
            <Eye aria-hidden className="size-4" />
          )}
        </button>
      )}
    </div>
  );
});
