/** The assistant opens a page's form and fills it (tool open_form); the person checks it and presses the button.
 *  Works on any form the pages already have: go to the page, press the button that opens the dialog, put each value
 *  in the field of that name as if typed (so React state follows), then point at the submit button. Nothing is
 *  submitted here. Pages with list fields (the typed-in contract's items) take their values from `takePrefill`. */
import { openFeedback } from "@/feedback/FeedbackDialog";

export type UiCard = { type: "ui"; form: string; title: string; path: string; open: string | null; submit: string;
  values: Record<string, unknown> };

let pending: UiCard | null = null;

/** For a page that fills itself (arrays, controlled state): the prefill waiting for this form. It stays readable until
 *  the fill is over (React may run a state initializer twice in development). */
export function takePrefill(form: string, path?: string): Record<string, unknown> | null {
  return pending?.form === form && (!path || pending.path === path) ? pending.values : null;
}
/** The page has applied the prefill (a contract review waits until the file is read, so it clears it itself). */
export function clearPrefill(form: string) {
  if (pending?.form === form) pending = null;
}
export const PREFILL_EVENT = "assistant:prefill";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(find: () => T | null | undefined, ms = 8000): Promise<T | null> {
  for (let t = 0; t < ms; t += 150) {
    const x = find();
    if (x) return x;
    await sleep(150);
  }
  return null;
}

function setField(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: unknown) {
  const proto = Object.getPrototypeOf(el);
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, String(value ?? ""));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const button = (root: ParentNode, label: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

/** Mark the form as filled by the assistant and point at its button. */
function point(form: HTMLElement, ui: UiCard) {
  form.querySelector("[data-prefill-note]")?.remove();
  const note = document.createElement("p");
  note.dataset.prefillNote = "1";
  note.className = "rounded-lg bg-act-soft px-3 py-2 text-[13px] text-act";
  note.textContent = `✦ Trợ lý đã điền sẵn — kiểm tra, sửa nếu cần rồi bấm «${ui.submit}». Chưa có gì được lưu.`;
  form.prepend(note);
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]") ?? button(form, ui.submit);
  if (submit) {
    submit.classList.add("ring-4", "ring-act/40");
    submit.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => submit.classList.remove("ring-4", "ring-act/40"), 8000);
  }
}

export async function runPrefill(ui: UiCard, navigate: (to: string) => void) {
  pending = ui;
  if (ui.path) navigate(ui.path);                 // Góp ý is a popup over whatever page the person is on
  window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: ui }));
  if (ui.form === "contract_review") return;      // the contract page fills itself once the file is read (ContractPage)
  await sleep(300);
  let form: HTMLFormElement | null;
  if (ui.form === "feedback") {
    openFeedback();
    form = await waitFor(() => document.querySelector<HTMLFormElement>("dialog[open] form"));
  } else if (ui.open) {
    const opener = await waitFor(() => button(document.querySelector("main") ?? document, ui.open!));
    if (!opener) return;
    opener.click();
    form = await waitFor(() => document.querySelector<HTMLFormElement>("dialog[open] form"));
  } else {
    form = await waitFor(() => document.querySelector<HTMLFormElement>("main form"));
  }
  setTimeout(() => { if (pending === ui) pending = null; }, 3000);
  if (!form) return;
  for (const [name, value] of Object.entries(ui.values)) {
    if (value == null || typeof value === "object") continue;      // lists: the page fills them (takePrefill)
    let el = form.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`);
    if (!el && /^[hsd]\d+$/.test(name)) {                          // one more holder row in the sale dialog
      const add = [...form.querySelectorAll("button")].find((b) => b.textContent?.includes("Thêm người giữ"));
      for (let i = 0; i < 10 && !el && add; i++) {
        add.click();
        await sleep(60);
        el = form.querySelector<HTMLInputElement>(`[name="${CSS.escape(name)}"]`);
      }
    }
    if (el && el.type !== "file" && el.type !== "hidden") setField(el, value);
  }
  point(form, ui);
}
