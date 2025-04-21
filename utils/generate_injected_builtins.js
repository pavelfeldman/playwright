const gSetTimeout = globalThis.__playwright_builtins__?.setTimeout ?? globalThis.setTimeout;
const gClearTimeout = globalThis.__playwright_builtins__?.clearTimeout ?? globalThis.clearTimeout;
const gSetInterval = globalThis.__playwright_builtins__?.setInterval ?? globalThis.setInterval;
const gClearInterval = globalThis.__playwright_builtins__?.clearInterval ?? globalThis.clearInterval;
const gRequestAnimationFrame = globalThis.__playwright_builtins__?.requestAnimationFrame ?? globalThis.requestAnimationFrame;
const gCancelAnimationFrame = globalThis.__playwright_builtins__?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame;
const gRequestIdleCallback = globalThis.__playwright_builtins__?.requestIdleCallback ?? globalThis.requestIdleCallback;
const gCancelIdleCallback = globalThis.__playwright_builtins__?.cancelIdleCallback ?? globalThis.cancelIdleCallback;
const gPerformance = globalThis.__playwright_builtins__?.performance ?? globalThis.performance;
const gEval = globalThis.__playwright_builtins__?.eval ?? globalThis.eval;
const gIntl = globalThis.__playwright_builtins__?.Intl ?? globalThis.Intl;
const gDate = globalThis.__playwright_builtins__?.Date ?? globalThis.Date;
const gMap = globalThis.__playwright_builtins__?.Map ?? globalThis.Map;
const gSet = globalThis.__playwright_builtins__?.Set ?? globalThis.Set;

export {
  gSetTimeout as 'setTimeout',
  gClearTimeout as 'clearTimeout',
  gSetInterval as 'setInterval',
  gClearInterval as 'clearInterval',
  gRequestAnimationFrame as 'requestAnimationFrame',
  gCancelAnimationFrame as 'cancelAnimationFrame',
  gRequestIdleCallback as 'requestIdleCallback',
  gCancelIdleCallback as 'cancelIdleCallback',
  gPerformance as 'performance',
  gEval as 'eval',
  gIntl as 'Intl',
  gDate as 'Date',
  gMap as 'Map',
  gSet as 'Set',
};
