// HUB-FR-60 · một bước (①–⑤) của editor: thẻ có tiêu đề đánh số.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";

type Props = { n: 1 | 2 | 3 | 4 | 5; children: ReactNode };

export function StepCard({ n, children }: Props) {
  const { t } = useTranslation();
  return (
    <Card aria-labelledby={`step-${n}`}>
      <CardHeader>
        <CardTitle id={`step-${n}`} className="text-section-title">
          <span className="mr-2 text-muted-foreground">{n}</span>
          {t(`editor.step.${n}`)}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
