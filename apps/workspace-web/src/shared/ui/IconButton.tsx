// CR-177 W3b · nút chỉ icon: kit Button (size icon) + Tooltip lấy chữ từ `aria-label` (thay `title=`).
import { Button, type ButtonProps } from "@ai/web-kit/ui/kit/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";

type IconButtonProps = Omit<Extract<ButtonProps, { size: "icon" }>, "size"> & {
  "aria-label": string;
};

export function IconButton(props: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="quiet" {...props} size="icon" />
      </TooltipTrigger>
      <TooltipContent>{props["aria-label"]}</TooltipContent>
    </Tooltip>
  );
}
