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
  uploadFile(filePath: string, mimeType: string): Promise<UploadedFile>;

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
   * @param filePath - Absolute path to the file to upload
   * @param mimeType - MIME type of the file
   * @returns Upload result with file URI and metadata
   */
  async uploadFile(filePath: string, mimeType: string): Promise<UploadedFile> {
    const ai = await this.ensureClient();

    const uploaded = await ai.files.upload({
      file: filePath,
      config: { mimeType }
    });

    // Normalize the response structure (API may return different shapes)
    const uploadedFile: any = (uploaded as any).file ?? uploaded;

    return {
      uri: uploadedFile?.uri,
      fileUri: uploadedFile?.fileUri,
      mimeType: uploadedFile?.mimeType,
      fileMimeType: uploadedFile?.fileMimeType
    };
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

    return {
      text: (result as any).text,
      response: (result as any).response
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
