/**
 * Services Module - Centralized Dependency Injection
 *
 * This module exports all service interfaces, implementations, and factory functions
 * for dependency injection throughout the application.
 *
 * Benefits:
 * - Better testability: Services can be easily mocked
 * - Loose coupling: Components depend on interfaces, not concrete implementations
 * - Single point of configuration: All service creation goes through factory functions
 *
 * @example
 * ```typescript
 * import {
 *   createAnthropicService,
 *   createGeminiService,
 *   createFileSystemService,
 *   IAnthropicService
 * } from "./services/index.js";
 *
 * // Create services with real implementations
 * const anthropic = createAnthropicService(apiKey);
 * const gemini = createGeminiService(apiKey);
 * const fs = createFileSystemService();
 *
 * // Or mock for testing
 * const mockAnthropic: IAnthropicService = {
 *   generateMessage: async () => "test response"
 * };
 * ```
 */

// Anthropic Service
export {
  IAnthropicService,
  AnthropicService,
  createAnthropicService,
  MessageParams
} from "./AnthropicService.js";

// Gemini Service
export {
  IGeminiService,
  GeminiService,
  createGeminiService,
  UploadedFile,
  GenerateContentParams,
  GenerateContentResult
} from "./GeminiService.js";

// File System Service
export {
  IFileSystemService,
  FileSystemService,
  createFileSystemService,
  MkdirOptions
} from "./FileSystemService.js";

// Service Container (optional but recommended)
export {
  ServiceContainer,
  createServiceContainer
} from "./ServiceContainer.js";
