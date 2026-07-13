export class BankProviderError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly code?: string;

  constructor(message: string, status: number, retryable: boolean, code?: string) {
    super(message);
    this.name = "BankProviderError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

type CircuitState = { failures: number; openedAt?: number };
const circuits = new Map<string, CircuitState>();

export async function withProviderResilience<T>(
  key: string,
  operation: () => Promise<T>,
  options: { retries?: number; baseDelayMs?: number; circuitThreshold?: number; circuitResetMs?: number; sleep?: (milliseconds: number) => Promise<void>; now?: () => number } = {},
): Promise<T> {
  const retries = options.retries ?? 3;
  const threshold = options.circuitThreshold ?? 5;
  const resetMs = options.circuitResetMs ?? 30_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const circuit = circuits.get(key) ?? { failures: 0 };

  if (circuit.openedAt && now() - circuit.openedAt < resetMs) {
    throw new BankProviderError("The bank data provider is temporarily unavailable.", 503, true, "circuit_open");
  }
  if (circuit.openedAt) {
    circuit.failures = 0;
    delete circuit.openedAt;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await operation();
      circuits.delete(key);
      return result;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof BankProviderError ? error.retryable : true;
      if (!retryable || attempt === retries) break;
      const delay = (options.baseDelayMs ?? 200) * 2 ** attempt + Math.floor(Math.random() * 50);
      await sleep(delay);
    }
  }

  circuit.failures += 1;
  if (circuit.failures >= threshold) circuit.openedAt = now();
  circuits.set(key, circuit);
  throw lastError;
}

export function resetProviderCircuitsForTests() {
  circuits.clear();
}
