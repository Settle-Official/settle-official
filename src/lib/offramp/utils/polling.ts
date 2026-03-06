// Polling utilities for async operations

export interface PollOptions {
  interval?: number; // milliseconds between polls
  timeout?: number; // total timeout in milliseconds
  onProgress?: (attempt: number) => void;
}

export async function pollWithTimeout<T>(
  pollFn: () => Promise<T>,
  checkCondition: (result: T) => boolean,
  options: PollOptions = {}
): Promise<T> {
  const {
    interval = 5000,
    timeout = 300000, // 5 minutes default
    onProgress,
  } = options;

  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < timeout) {
    attempt++;
    onProgress?.(attempt);

    const result = await pollFn();

    if (checkCondition(result)) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error("Polling timeout exceeded");
}

export async function exponentialBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;

      const delay = baseDelay * Math.pow(2, i);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Max retries exceeded");
}

export async function pollBridgeStatus(
  getStatus: () => Promise<{ status: string }>,
  terminalStates: string[],
  options: PollOptions = {}
): Promise<{ status: string }> {
  return pollWithTimeout(
    getStatus,
    (result) => terminalStates.includes(result.status),
    {
      interval: 5000, // 5 seconds
      timeout: 600000, // 10 minutes
      ...options,
    }
  );
}

export async function pollPayoutStatus(
  getStatus: () => Promise<{ status: string }>,
  terminalStates: string[],
  options: PollOptions = {}
): Promise<{ status: string }> {
  return pollWithTimeout(
    getStatus,
    (result) => terminalStates.includes(result.status),
    {
      interval: 10000, // 10 seconds
      timeout: 600000, // 10 minutes
      ...options,
    }
  );
}
