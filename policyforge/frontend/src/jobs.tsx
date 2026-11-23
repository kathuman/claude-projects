// Polling a background job (evaluations, re-tests) until it ends, for progress bars.
import { useQuery } from "@tanstack/react-query";
import { api, type Job } from "./api";

export function useJob(id: string | null) {
  return useQuery({
    queryKey: ["job", id], queryFn: () => api.job(id!), enabled: !!id,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === "done" || q.state.data.status === "failed") ? false : 400),
  });
}

export function JobBar({ job }: { job: Job | undefined }) {
  if (!job) return null;
  const pct = Math.round(job.progress * 100);
  return (
    <div className="flex flex-col gap-1 max-w-[520px]" data-testid="job" data-status={job.status}>
      <div className="flex justify-between text-[12px]">
        <span className="text-ink-dim">{job.title}</span>
        <span className={`mono ${job.status === "failed" ? "text-bad" : "text-ink-faint"}`}>
          {job.status === "failed" ? "failed" : job.status === "done" ? "done" : `${pct}% · ${job.message}`}</span>
      </div>
      <div className="h-2 rounded bg-panel-2 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent transition-all" style={{ width: `${job.status === "done" ? 100 : pct}%` }} />
      </div>
      {job.error && <div className="err">{job.error}</div>}
    </div>
  );
}
