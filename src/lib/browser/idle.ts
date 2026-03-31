export type IdleDeadlineLike = {
  didTimeout: boolean;
  timeRemaining: () => number;
};

export type IdleCallbackLike = (deadline: IdleDeadlineLike) => void;

export type IdleHandle = number | ReturnType<typeof setTimeout>;

const createFallbackDeadline = (): IdleDeadlineLike => ({
  didTimeout: false,
  timeRemaining: () => 0,
});

export function scheduleIdleCallback(
  callback: IdleCallbackLike,
  timeout = 150,
): IdleHandle {
  if (typeof window === "undefined") return 0;

  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback, { timeout });
  }

  return globalThis.setTimeout(() => {
    callback(createFallbackDeadline());
  }, Math.min(timeout, 32));
}

export function cancelIdleCallback(handle: IdleHandle) {
  if (typeof window === "undefined" || handle === 0) return;

  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle as number);
    return;
  }

  globalThis.clearTimeout(handle);
}
