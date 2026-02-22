export async function postJsonWithRetry<TResponse>(
  url: string,
  init: {
    headers: Record<string, string>;
    body: Record<string, unknown>;
  },
  options?: {
    maxRetries?: number;
    initialDelayMs?: number;
  },
): Promise<TResponse> {
  const maxRetries = options?.maxRetries ?? 2;
  const initialDelayMs = options?.initialDelayMs ?? 300;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...init.headers,
        },
        body: JSON.stringify(init.body),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      return (await response.json()) as TResponse;
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries) {
        break;
      }

      const delayMs = initialDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
