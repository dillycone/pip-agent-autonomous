import { runPipeline } from "@pip/pipeline/runPipeline";
import type { RunPipelineParams, PipelineHandlers } from "@pip/pipeline/runPipeline";
import { runStore } from "@pip/server/runStore";

export async function executeRun(params: Omit<RunPipelineParams, "handlers">): Promise<void> {
  const { runId, signal, ...rest } = params;

  console.log(`[executeRun] Starting run ${runId}`);

  const handlers: PipelineHandlers = {
    emit: (event, data) => {
      console.log(`[executeRun] Event: ${event}`, typeof data === 'object' && data !== null ? JSON.stringify(data).slice(0, 100) : data);
      runStore.appendEvent(runId, event, data);
    },
    setRunStatus: (status, error) => {
      console.log(`[executeRun] Status: ${status}`, error ? 'with error' : '');
      runStore.setStatus(runId, status, error);
    },
    finish: () => {
      console.log(`[executeRun] Finishing run ${runId}`);
      runStore.finish(runId);
    }
  };

  try {
    await runPipeline({
      runId,
      signal,
      handlers,
      ...rest
    });
    console.log(`[executeRun] Pipeline completed for ${runId}`);
  } catch (error) {
    console.error(`[executeRun] Pipeline error for ${runId}:`, error);
    throw error;
  }
}
