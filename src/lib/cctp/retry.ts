/**
 * Retry a network-dependent operation once on failure. Meant for read-only /
 * simulate-only calls (RPC reads, fee quotes) where retrying is always safe —
 * never wrap anything that broadcasts or mutates state.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const delayMs = opts.delayMs ?? 750;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/** True for Node's raw fetch-level failures (DNS, connection reset, timeout) — not HTTP error responses. */
export function isNetworkFetchError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    typeof error.message === "string" &&
    /fetch failed/i.test(error.message)
  );
}
