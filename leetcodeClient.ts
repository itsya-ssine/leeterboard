/**
 * Centralized LeetCode GraphQL Client (SEC-11 / CQ-02)
 *
 * Provides a unified interface for calling LeetCode's upstream GraphQL endpoint
 * with timeout handling, standard headers, and circuit breaker state tracking.
 */

export const LEETCODE_GRAPHQL_URL = "https://leetcode.com/graphql";

export const DEFAULT_LEETCODE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "User-Agent":
    process.env.LEETCODE_USER_AGENT ||
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
  "Referer": "https://leetcode.com",
  "Origin": "https://leetcode.com"
};

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  isOpen: boolean;
}

const circuitState: CircuitBreakerState = {
  failures: 0,
  lastFailure: 0,
  isOpen: false
};

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60_000;

export function getCircuitState(): Readonly<CircuitBreakerState> {
  if (circuitState.isOpen && Date.now() - circuitState.lastFailure > COOLDOWN_MS) {
    circuitState.isOpen = false;
    circuitState.failures = 0;
  }
  return { ...circuitState };
}

export function resetCircuitState(): void {
  circuitState.failures = 0;
  circuitState.lastFailure = 0;
  circuitState.isOpen = false;
}

export async function executeLeetCodeGraphQL<T = any>(
  query: string,
  variables: Record<string, unknown>,
  timeoutMs = 4000
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const circuit = getCircuitState();
  if (circuit.isOpen) {
    return { ok: false, error: "LeetCode upstream circuit breaker is OPEN due to repeated failures." };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(LEETCODE_GRAPHQL_URL, {
      method: "POST",
      headers: DEFAULT_LEETCODE_HEADERS,
      body: JSON.stringify({ query, variables }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      circuitState.failures++;
      circuitState.lastFailure = Date.now();
      if (circuitState.failures >= FAILURE_THRESHOLD) circuitState.isOpen = true;
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    const json = await response.json();
    if (json?.errors && !json?.data) {
      return { ok: false, error: json.errors[0]?.message || "GraphQL Error" };
    }

    // Success resets consecutive failures
    circuitState.failures = 0;
    circuitState.isOpen = false;
    return { ok: true, data: json.data };
  } catch (err: any) {
    clearTimeout(timeoutId);
    circuitState.failures++;
    circuitState.lastFailure = Date.now();
    if (circuitState.failures >= FAILURE_THRESHOLD) circuitState.isOpen = true;
    return { ok: false, error: err.message || "Network Error" };
  }
}
