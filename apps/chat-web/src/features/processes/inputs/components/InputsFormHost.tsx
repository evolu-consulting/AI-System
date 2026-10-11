// HUB-FR-124 · AC-H37 · chỗ mount duy nhất của form `!key` (AppShell, chunk lười): vẽ form khi `intercept` mở yêu cầu.
import { useInputsRequest } from "../lib/inputs-store";
import { InputsForm } from "./InputsForm";

export function InputsFormHost() {
  const request = useInputsRequest();
  return request ? <InputsForm request={request} /> : null;
}
