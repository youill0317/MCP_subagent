export async function postJsonWithRetry<TResponse>(
  url: string,
  init: {
    headers: Record<string, string>;
    body: Record<string, unknown>;
  },
  options?: {
    maxRetries?: number;
    initialDelayMs?: number;
    signal?: AbortSignal;
  },
): Promise<TResponse> {
  const maxRetries = options?.maxRetries ?? 2;
  const initialDelayMs = options?.initialDelayMs ?? 300;
  const signal = options?.signal;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) {
      throw toAbortError();
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...init.headers,
        },
        body: JSON.stringify(init.body),
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`HTTP ${response.status}: ${text}`);

        if (attempt < maxRetries && isRetryableStatus(response.status)) {
          await sleepWithAbort(backoffWithJitter(initialDelayMs, attempt), signal);
          continue;
        }

        throw error;
      }

      return (await response.json()) as TResponse;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      lastError = error;

      if (attempt >= maxRetries || !isRetryableNetworkError(error)) {
        break;
      }

      await sleepWithAbort(backoffWithJitter(initialDelayMs, attempt), signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableStatus(status: number): boolean {
  if (status >= 500 && status <= 599) {
    return true;
  }

  return status === 408 || status === 409 || status === 425 || status === 429;
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (isAbortError(error)) {
    return false;
  }

  if (error.name === "TypeError") {
    return true;
  }

  const message = error.message.toLowerCase();
  return message.includes("network") || message.includes("timed out") || message.includes("socket");
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError";
}

function toAbortError(): Error {
  const abortError = new Error("The operation was aborted");
  abortError.name = "AbortError";
  return abortError;
}

function backoffWithJitter(initialDelayMs: number, attempt: number): number {
  const base = initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(base * 0.2 * Math.random());
  return base + jitter;
}

function sleepWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }

    if (signal.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };

    signal.addEventListener("abort", onAbort);
  });
}
