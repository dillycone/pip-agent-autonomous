/**
 * Service Container - Simple Dependency Injection Container
 *
 * This container manages service instances and their lifecycle,
 * providing a centralized place to register and resolve dependencies.
 *
 * Features:
 * - Singleton management: Services are created once and reused
 * - Factory pattern: Services are created lazily when first requested
 * - Type-safe: Full TypeScript support with generics
 *
 * @example
 * ```typescript
 * const container = createServiceContainer();
 *
 * // Register services
 * container.register('anthropic', () =>
 *   createAnthropicService(process.env.ANTHROPIC_API_KEY!)
 * );
 * container.register('gemini', () =>
 *   createGeminiService(process.env.GEMINI_API_KEY!)
 * );
 *
 * // Resolve services
 * const anthropic = container.resolve<IAnthropicService>('anthropic');
 * const gemini = container.resolve<IGeminiService>('gemini');
 * ```
 */

/**
 * Factory function type for creating service instances
 */
type ServiceFactory<T = any> = () => T;

/**
 * Service container for dependency injection
 *
 * This simple container provides basic DI functionality:
 * - register: Add a service factory
 * - resolve: Get or create a service instance (singleton)
 * - has: Check if a service is registered
 * - clear: Remove all registered services
 */
export class ServiceContainer {
  private factories = new Map<string, ServiceFactory>();
  private instances = new Map<string, any>();

  /**
   * Register a service factory
   *
   * @param name - Service identifier (e.g., "anthropic", "gemini")
   * @param factory - Factory function that creates the service
   *
   * @example
   * ```typescript
   * container.register('anthropic', () =>
   *   createAnthropicService(apiKey)
   * );
   * ```
   */
  register<T>(name: string, factory: ServiceFactory<T>): void {
    this.factories.set(name, factory);
  }

  /**
   * Resolve a service instance (creates if needed, then caches)
   *
   * @param name - Service identifier
   * @returns The service instance
   * @throws Error if service is not registered
   *
   * @example
   * ```typescript
   * const anthropic = container.resolve<IAnthropicService>('anthropic');
   * ```
   */
  resolve<T>(name: string): T {
    // Return cached instance if available
    if (this.instances.has(name)) {
      return this.instances.get(name) as T;
    }

    // Get factory and create instance
    const factory = this.factories.get(name);
    if (!factory) {
      throw new Error(`Service '${name}' is not registered in the container`);
    }

    const instance = factory();
    this.instances.set(name, instance);
    return instance as T;
  }

  /**
   * Check if a service is registered
   *
   * @param name - Service identifier
   * @returns true if the service is registered, false otherwise
   */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /**
   * Clear all registered services and cached instances
   *
   * Useful for testing or resetting the container state.
   */
  clear(): void {
    this.factories.clear();
    this.instances.clear();
  }

  /**
   * Get all registered service names
   *
   * @returns Array of service identifiers
   */
  getRegisteredServices(): string[] {
    return Array.from(this.factories.keys());
  }
}

/**
 * Factory function to create a new service container
 *
 * @returns A new ServiceContainer instance
 *
 * @example
 * ```typescript
 * const container = createServiceContainer();
 * container.register('anthropic', () => createAnthropicService(apiKey));
 * ```
 */
export function createServiceContainer(): ServiceContainer {
  return new ServiceContainer();
}
