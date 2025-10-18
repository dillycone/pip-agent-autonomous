/**
 * Pipeline Client
 *
 * API communication layer for pipeline operations.
 * Handles HTTP requests, error handling, and response parsing.
 */

/**
 * Run Response
 */
export interface RunResponse {
  runId: string;
}

/**
 * Error Response
 */
export interface ErrorResponse {
  error: string;
  details?: unknown;
}

/**
 * Pipeline Client
 */
export class PipelineClient {
  /**
   * Start a new pipeline run
   */
  async startRun(params: {
    audio: string;
    template: string;
    outdoc: string;
    inputLanguage: string;
    outputLanguage: string;
  }): Promise<{ success: true; runId: string } | { success: false; error: string; details?: unknown }> {
    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: params.audio,
          template: params.template,
          outdoc: params.outdoc,
          inputLanguage: params.inputLanguage,
          outputLanguage: params.outputLanguage,
        }),
      });

      const payload = (await response
        .json()
        .catch(() => null)) as
        | { runId?: string }
        | { error?: string; details?: unknown }
        | null;

      if (
        !response.ok ||
        !payload ||
        typeof (payload as any).runId !== "string"
      ) {
        const message =
          typeof (payload as any)?.error === "string"
            ? (payload as any).error
            : `Run request failed (${response.status})`;
        return {
          success: false,
          error: message,
          details: payload,
        };
      }

      const { runId } = payload as { runId: string };
      return { success: true, runId };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Abort a running pipeline
   */
  async abortRun(runId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(
        `/api/run/${encodeURIComponent(runId)}/abort`,
        { method: "POST" }
      );

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ error: "Unknown error" }));
        return {
          success: false,
          error: error.error || response.statusText,
        };
      }

      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Get pipeline state snapshot
   */
  async getState(runId: string): Promise<{ success: boolean; state?: any; error?: string }> {
    try {
      const response = await fetch(
        `/api/run/${encodeURIComponent(runId)}/state`
      );

      if (!response.ok) {
        return {
          success: false,
          error: `State fetch failed: ${response.status}`,
        };
      }

      const state = await response.json().catch(() => null);
      if (!state) {
        return {
          success: false,
          error: "Failed to parse state response",
        };
      }

      return { success: true, state };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }

  /**
   * Create EventSource for streaming events
   */
  createEventSource(runId: string): EventSource {
    return new EventSource(`/api/run/${encodeURIComponent(runId)}/stream`);
  }
}

/**
 * Default client instance
 */
export const pipelineClient = new PipelineClient();
