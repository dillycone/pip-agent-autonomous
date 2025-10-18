/**
 * Test Utilities and Helpers
 *
 * Shared testing utilities for mocking and assertions
 */

/**
 * Mock EventSource for testing
 */
export class MockEventSource {
  url: string;
  readyState: number = 0; // CONNECTING
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners: Map<string, Set<EventListener>> = new Map();

  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  constructor(url: string) {
    this.url = url;
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockEventSource.OPEN;
      if (this.onopen) {
        this.onopen(new Event('open'));
      }
    }, 0);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
    }
    return true;
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }

  // Helper method to simulate server-sent events
  simulateMessage(type: string, data: string): void {
    const event = new MessageEvent(type, { data });
    this.dispatchEvent(event);
    const listeners = this.listeners.get(type);
    if (listeners) {
      listeners.forEach((listener) => listener(event));
    }
  }

  // Helper to simulate error
  simulateError(): void {
    const event = new Event('error');
    if (this.onerror) {
      this.onerror(event);
    }
  }
}

/**
 * Mock fetch for API calls
 */
export function createMockFetch(
  responses: Map<string, { status: number; body: any }>
): typeof fetch {
  return jest.fn((url: string | URL | Request, init?: RequestInit) => {
    const urlString = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    const response = responses.get(urlString);

    if (!response) {
      return Promise.resolve({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Not found' }),
      } as Response);
    }

    return Promise.resolve({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.status === 200 ? 'OK' : 'Error',
      json: async () => response.body,
    } as Response);
  }) as any;
}

/**
 * Wait for async updates (for testing hooks)
 */
export const waitForAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Create mock timer helpers
 */
export function setupMockTimers() {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });
}

/**
 * Delay helper for testing
 */
export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
