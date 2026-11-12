// CR-127 · U3 · nút «Chạy thử» trên thanh dưới của màn soạn quy trình theo sự kiện (chỉ quản trị nền tảng, công ty đã chọn).
import type { AppEventDecl } from "@ai/contracts/app-manifest";
import { FlaskConical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { RunSource } from "../../lib/test-run";
import { TestRunDialog } from "./TestRunDialog";

type Props = {
  tenantId: string;
  name: string;
  event: AppEventDecl | undefined;
  source: () => RunSource;
};

export function TestRunButton(p: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const label = (t as unknown as (k: string) => string)("process.admin.flow.testRun.button");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="testrun-open"
      >
        <FlaskConical aria-hidden className="size-4" />
        {label}
      </Button>
      {open ? <TestRunDialog {...p} open onClose={() => setOpen(false)} /> : null}
    </>
  );
}
