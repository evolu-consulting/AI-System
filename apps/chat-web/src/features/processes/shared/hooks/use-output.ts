// CR-056 · P-a: nội dung output theo `output_id` (bất biến ⇒ `staleTime: Infinity`).
import { useQuery } from "@tanstack/react-query";
import { fetchOutput } from "../api";
import { processKeys } from "../keys";

export function useOutput(runId: string, outputId: string) {
  return useQuery({
    queryKey: processKeys.output(outputId),
    queryFn: ({ signal }) => fetchOutput(runId, outputId, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
}
