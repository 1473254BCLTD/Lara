import { describe, expect, it, vi } from "vitest";

import { runWithShutdownDeadline } from "../../src/shutdown-deadline.js";

describe("runWithShutdownDeadline", () => {
  it("cancels the deadline after successful shutdown", async () => {
    vi.useFakeTimers();

    try {
      const operation = vi.fn(async () => {});
      const onTimeout = vi.fn();

      await runWithShutdownDeadline(
        operation,
        10_000,
        onTimeout,
      );

      expect(operation).toHaveBeenCalledOnce();
      expect(onTimeout).not.toHaveBeenCalled();

      // The deadline timer must have been removed.
      expect(vi.getTimerCount()).toBe(0);

      // Advancing time must not trigger an old timer.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("invokes the timeout callback when shutdown remains pending", async () => {
    vi.useFakeTimers();

    let completeOperation!: () => void;

    const pendingOperation = new Promise<void>((resolve) => {
      completeOperation = resolve;
    });

    const onTimeout = vi.fn();

    const shutdown = runWithShutdownDeadline(
      () => pendingOperation,
      10_000,
      onTimeout,
    );

    try {
      // The deadline must not fire early.
      await vi.advanceTimersByTimeAsync(9_999);

      expect(onTimeout).not.toHaveBeenCalled();

      // Reach the deadline.
      await vi.advanceTimersByTimeAsync(1);

      expect(onTimeout).toHaveBeenCalledOnce();

      // Timeout notification does not cancel the operation.
      await vi.advanceTimersByTimeAsync(10_000);

      expect(onTimeout).toHaveBeenCalledOnce();

      // Simulate cleanup eventually finishing.
      completeOperation();

      await shutdown;

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      // Release the pending operation even if an assertion fails.
      completeOperation();
      await shutdown;

      vi.useRealTimers();
    }
  });

  it("preserves shutdown failures and cancels the deadline", async () => {
    vi.useFakeTimers();

    try {
      const shutdownError = new Error("Database cleanup failed");
      const onTimeout = vi.fn();

      await expect(
        runWithShutdownDeadline(
          async () => {
            throw shutdownError;
          },
          10_000,
          onTimeout,
        ),
      ).rejects.toBe(shutdownError);

      expect(onTimeout).not.toHaveBeenCalled();

      // A failed operation must not leave a timer running.
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(onTimeout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});