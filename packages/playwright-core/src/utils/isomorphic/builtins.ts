/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type Builtins = {
  setTimeout: Window['setTimeout'],
  clearTimeout: Window['clearTimeout'],
  setInterval: Window['setInterval'],
  clearInterval: Window['clearInterval'],
  requestAnimationFrame: Window['requestAnimationFrame'],
  cancelAnimationFrame: Window['cancelAnimationFrame'],
  requestIdleCallback: Window['requestIdleCallback'],
  cancelIdleCallback: (id: number) => void,
  performance: Window['performance'],
  eval: typeof window['eval'],
  Intl: typeof window['Intl'],
  Date: typeof window['Date'],
  Map: typeof window['Map'],
  Set: typeof window['Set'],
};

// "builtins()" function is evaluated inside an InitScript before
// anything else happens in the page. This way, original builtins are saved on the global object
// before page can temper with them. Later on, any call to builtins() will retrieve the stored
// builtins instead of initializing them again.
export function builtins(): Builtins {
  if ((globalThis as any)['__playwright_builtins__'])
    return (globalThis as any)['__playwright_builtins__'];
  (globalThis as any)['__playwright_builtins__'] = {
    setTimeout: globalThis.setTimeout?.bind(globalThis),
    clearTimeout: globalThis.clearTimeout?.bind(globalThis),
    setInterval: globalThis.setInterval?.bind(globalThis),
    clearInterval: globalThis.clearInterval?.bind(globalThis),
    requestAnimationFrame: globalThis.requestAnimationFrame?.bind(globalThis),
    cancelAnimationFrame: globalThis.cancelAnimationFrame?.bind(globalThis),
    requestIdleCallback: globalThis.requestIdleCallback?.bind(globalThis),
    cancelIdleCallback: globalThis.cancelIdleCallback?.bind(globalThis),
    performance: globalThis.performance,
    eval: globalThis.eval?.bind(globalThis),
    Intl: globalThis.Intl,
    Date: globalThis.Date,
    Map: globalThis.Map,
    Set: globalThis.Set,
  };
  return (globalThis as any)['__playwright_builtins__'] as Builtins;
}
