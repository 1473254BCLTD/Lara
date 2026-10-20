/**
 * Run shutdown with a bounded deadline.
 *
 * The caller owns the timeout action, such as terminating
 * the process. This helper does not exit the process.
 *
 * The timeout does not cancel the pending operation itself.
 */
export async function runWithShutdownDeadline(
  operation: () => Promise<void>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  const timeout = setTimeout(onTimeout, timeoutMs);

  try {
    await operation();
  } finally {
    clearTimeout(timeout);
  }
}