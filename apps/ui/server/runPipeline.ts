import { runPipeline } from "@pip/pipeline/runPipeline";
import type { RunPipelineParams, PipelineHandlers } from "@pip/pipeline/runPipeline";
import { runStore } from "@pip/server/runStore";

export async function executeRun(params: Omit<RunPipelineParams, "handlers">): Promise<void> {
  const { runId, signal, ...rest } = params;

  const handlers: PipelineHandlers = {
    emit: (event, data) => runStore.appendEvent(runId, event, data),
    setRunStatus: (status, error) => runStore.setStatus(runId, status, error),
    finish: () => runStore.finish(runId)
  };

  await runPipeline({
    signal,
    handlers,
    ...rest
  });
}
