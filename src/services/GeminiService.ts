import { Readable } from "node:stream";

/**
 * Gemini Service - Dependency Injection Wrapper for Google Gen AI SDK
 *
 * This service encapsulates all interactions with the Gemini API,
 * making the codebase more testable and maintainable by allowing
 * dependencies to be injected rather than created inline.
 *
 * @example
 * ```typescript
 * const service = createGeminiService(apiKey);
 * const uploadedFile = await service.uploadFile("/path/to/audio.mp3", "audio/mp3");
 * const result = await service.generateContent({
 *   model: "gemini-2.5-pro",
 *   contents: [...],
 *   config: { responseMimeType: "application/json" }
 * });
 * ```
 */

/**
 * Uploaded file information returned by Gemini
 */
export interface UploadedFile {
  /** URI reference for the uploaded file */
  uri?: string;
  /** Alternative URI field name */
  fileUri?: string;
  /** MIME type of the uploaded file */
  mimeType?: string;
  /** Alternative MIME type field name */
  fileMimeType?: string;
}

export type GeminiUploadSource = string | Buffer | Readable;

/**
 * Parameters for content generation
 */
export interface GenerateContentParams {
  /** Model identifier (e.g., "gemini-2.5-pro") */
  model: string;
  /** Array of content items with roles and parts */
  contents: Array<{
    role: string;
    parts: Array<{ text?: string; fileData?: { fileUri: string; mimeType: string } }>;
  }>;
  /** Configuration options */
  config?: {
    /** Expected response MIME type */
    responseMimeType?: string;
  };
}

/**
 * Result from content generation
 */
export interface GenerateContentResult {
  /** Generated text content */
  text?: string;
  /** Response object (may contain nested text getter) */
  response?: {
    text?: () => string;
  };
  /** Usage metadata including token counts (if provided by API) */
  usageMetadata?: Record<string, unknown>;
}

/**
 * Interface for Gemini service operations
 *
 * This interface allows for easy mocking in tests:
 * ```typescript
 * const mockService: IGeminiService = {
 *   uploadFile: async () => ({ uri: "mock://uri", mimeType: "audio/mp3" }),
 *   generateContent: async () => ({ text: "mock transcript" })
 * };
 * ```
 */
export interface IGeminiService {
  /**
   * Upload a file to Gemini for processing
   *
   * @param filePath - Absolute path to the file to upload
   * @param mimeType - MIME type of the file (e.g., "audio/mp3")
   * @returns Upload result with file URI and metadata
   * @throws Error if upload fails
   */
  uploadFile(file: GeminiUploadSource, mimeType: string): Promise<UploadedFile>;

  /**
   * Generate content using Gemini model
   *
   * @param params - Content generation parameters
   * @returns Generated content result
   * @throws Error if generation fails
   */
  generateContent(params: GenerateContentParams): Promise<GenerateContentResult>;
}

/**
 * Implementation of the Gemini service
 *
 * Wraps the Google Gen AI SDK and provides a clean interface
 * for file upload and content generation operations.
 */
export class GeminiService implements IGeminiService {
  private ai: any;

  /**
   * Create a new Gemini service instance
   *
   * @param apiKey - Gemini API key for authentication
   */
  constructor(apiKey: string) {
    // Lazy-load the Google Gen AI SDK to avoid import errors if not installed
    // This is safe because the service is only created when needed
    const loadGeminiSDK = async () => {
      const { GoogleGenAI } = await import("@google/genai");
      return new GoogleGenAI({ apiKey });
    };

    // Store the promise for lazy initialization
    this.aiPromise = loadGeminiSDK();
  }

  private aiPromise: Promise<any>;

  /**
   * Ensure the AI client is initialized
   */
  private async ensureClient() {
    if (!this.ai) {
      this.ai = await this.aiPromise;
    }
    return this.ai;
  }

  /**
   * Upload a file to Gemini for processing
   *
   * @param file - Absolute path, Buffer, or Readable stream for the file to upload
   * @param mimeType - MIME type of the file
   * @returns Upload result with file URI and metadata
   */
  async uploadFile(file: GeminiUploadSource, mimeType: string): Promise<UploadedFile> {
    const ai = await this.ensureClient();

    const payload: Record<string, unknown> = {
      config: { mimeType }
    };

    if (typeof file === "string") {
      payload.file = file;
    } else if (Buffer.isBuffer(file)) {
      payload.file = file;
    } else if (isReadableStream(file)) {
      payload.file = file;
    } else {
      throw new Error("Unsupported upload source type for GeminiService.uploadFile");
    }

    const uploaded = await ai.files.upload(payload);

    // Normalize the response structure (API may return different shapes)
    const normalized = normalizeUploadedFile(uploaded);

    if (!normalized.uri && !normalized.fileUri) {
      throw new Error("Gemini upload response missing file URI");
    }

    if (!normalized.mimeType && !normalized.fileMimeType) {
      normalized.mimeType = mimeType;
    }

    return normalized;
  }

  /**
   * Generate content using Gemini model
   *
   * @param params - Content generation parameters
   * @returns Generated content result
   */
  async generateContent(params: GenerateContentParams): Promise<GenerateContentResult> {
    const ai = await this.ensureClient();

    const result = await ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: params.config
    } as any);

    const rawResult = result as Record<string, unknown>;
    const text = typeof rawResult.text === "string" ? rawResult.text : undefined;
    const rawResponse = rawResult.response;

    let response: GenerateContentResult["response"];
    if (rawResponse && typeof rawResponse === "object" && typeof (rawResponse as any).text === "function") {
      const textFn = (rawResponse as { text: () => string }).text.bind(rawResponse);
      response = { text: textFn };
    }

    return {
      text,
      response,
      usageMetadata: extractUsageMetadata(result)
    };
  }
}

/**
 * Factory function to create a Gemini service instance
 *
 * This pattern allows for easy service creation while maintaining
 * the ability to swap implementations for testing.
 *
 * @param apiKey - Gemini API key for authentication
 * @returns An instance of IGeminiService
 *
 * @example
 * ```typescript
 * const service = createGeminiService(process.env.GEMINI_API_KEY!);
 * const uploaded = await service.uploadFile("/audio.mp3", "audio/mp3");
 * ```
 */
export function createGeminiService(apiKey: string): IGeminiService {
  return new GeminiService(apiKey);
}

function isReadableStream(value: unknown): value is Readable {
  return value instanceof Readable ||
    (value !== null &&
      typeof value === "object" &&
      typeof (value as Readable).pipe === "function");
}

function normalizeUploadedFile(uploaded: unknown): UploadedFile {
  const normalized: UploadedFile = {};

  if (!uploaded || (typeof uploaded !== "object" && typeof uploaded !== "function")) {
    return normalized;
  }
  const payload = (uploaded as any).file ?? uploaded;
  if (!payload || typeof payload !== "object") {
    return normalized;
  }
  const candidate = payload as Record<string, unknown>;

  if (typeof candidate.uri === "string") {
    normalized.uri = candidate.uri;
  }
  if (typeof candidate.fileUri === "string") {
    normalized.fileUri = candidate.fileUri;
  }
  if (typeof candidate.mimeType === "string") {
    normalized.mimeType = candidate.mimeType;
  }
  if (typeof candidate.fileMimeType === "string") {
    normalized.fileMimeType = candidate.fileMimeType;
  }

  return normalized;
}

/**
 * Extract usage metadata from the Gemini SDK response.
 *
 * The SDK may expose usage metadata on either the root response object or nested
 * within the response payload. This helper normalizes the common cases so callers
 * can reliably access token counts without having to inspect undocumented shapes.
 */
function extractUsageMetadata(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") {
    return undefined;
  }

  const candidates = [
    (result as any).usageMetadata,
    (result as any).usage_metadata,
    (result as any).response?.usageMetadata,
    (result as any).response?.usage_metadata,
    Array.isArray((result as any).response?.candidates)
      ? (result as any).response.candidates[0]?.usageMetadata
      : undefined,
    Array.isArray((result as any).response?.candidates)
      ? (result as any).response.candidates[0]?.usage_metadata
      : undefined
  ];

  for (const entry of candidates) {
    if (entry && typeof entry === "object") {
      return entry as Record<string, unknown>;
    }
  }

  return undefined;
}
