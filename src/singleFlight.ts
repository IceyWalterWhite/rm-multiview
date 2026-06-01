// Wraps an async fn so concurrent calls share one in-flight execution.
// Once that execution settles (resolve OR reject), the slot clears and the
// next call starts fresh. Used so N tiles hitting an expired signature at the
// same time trigger a single catalog re-fetch, not N.
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const p = fn().finally(() => { if (inFlight === p) inFlight = null; });
    inFlight = p;
    return p;
  };
}
