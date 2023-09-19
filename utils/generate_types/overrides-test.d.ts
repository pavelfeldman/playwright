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

import type { APIRequestContext, Browser, BrowserContext, BrowserContextOptions, Page, LaunchOptions, ViewportSize, Geolocation, HTTPCredentials, Locator, APIResponse, PageScreenshotOptions } from 'playwright-core';
export * from 'playwright-core';

export type ReporterDescription =
  ['dot'] |
  ['line'] |
  ['list'] |
  ['github'] |
  ['junit'] | ['junit', { outputFile?: string, stripANSIControlSequences?: boolean }] |
  ['json'] | ['json', { outputFile?: string }] |
  ['html'] | ['html', { outputFolder?: string, open?: 'always' | 'never' | 'on-failure', host?: string, port?: number, attachmentsBaseURL?: string }] |
  ['null'] |
  [string] | [string, any];

type UseOptions<TestArgs, WorkerArgs> = { [K in keyof WorkerArgs]?: WorkerArgs[K] } & { [K in keyof TestArgs]?: TestArgs[K] };

export interface Project<TestArgs = {}, WorkerArgs = {}> extends TestProject {
  use?: UseOptions<TestArgs, WorkerArgs>;
}

// [internal] !!! DO NOT ADD TO THIS !!!
// [internal] It is part of the public API and is computed from the user's config.
// [internal] If you need new fields internally, add them to FullProjectInternal instead.
export interface FullProject<TestArgs = {}, WorkerArgs = {}> {
  grep: RegExp | RegExp[];
  grepInvert: RegExp | RegExp[] | null;
  metadata: Metadata;
  name: string;
  dependencies: string[];
  snapshotDir: string;
  outputDir: string;
  repeatEach: number;
  retries: number;
  teardown?: string;
  testDir: string;
  testIgnore: string | RegExp | (string | RegExp)[];
  testMatch: string | RegExp | (string | RegExp)[];
  timeout: number;
  use: UseOptions<PlaywrightTestOptions & TestArgs, PlaywrightWorkerOptions & WorkerArgs>;
}
// [internal] !!! DO NOT ADD TO THIS !!! See prior note.

type LiteralUnion<T extends U, U = string> = T | (U & { zz_IGNORE_ME?: never });

interface TestConfig {
  reporter?: LiteralUnion<'list'|'dot'|'line'|'github'|'json'|'junit'|'null'|'html', string> | ReporterDescription[];
  webServer?: TestConfigWebServer | TestConfigWebServer[];
}

export interface Config<TestArgs = {}, WorkerArgs = {}> extends TestConfig {
  projects?: Project<TestArgs, WorkerArgs>[];
  use?: UseOptions<TestArgs, WorkerArgs>;
}

export type Metadata = { [key: string]: any };

// [internal] !!! DO NOT ADD TO THIS !!!
// [internal] It is part of the public API and is computed from the user's config.
// [internal] If you need new fields internally, add them to FullConfigInternal instead.
export interface FullConfig<TestArgs = {}, WorkerArgs = {}> {
  forbidOnly: boolean;
  fullyParallel: boolean;
  globalSetup: string | null;
  globalTeardown: string | null;
  globalTimeout: number;
  grep: RegExp | RegExp[];
  grepInvert: RegExp | RegExp[] | null;
  maxFailures: number;
  metadata: Metadata;
  version: string;
  preserveOutput: 'always' | 'never' | 'failures-only';
  projects: FullProject<TestArgs, WorkerArgs>[];
  reporter: ReporterDescription[];
  reportSlowTests: { max: number, threshold: number } | null;
  rootDir: string;
  quiet: boolean;
  shard: { total: number, current: number } | null;
  updateSnapshots: 'all' | 'none' | 'missing';
  workers: number;
  webServer: TestConfigWebServer | null;
  configFile?: string;
  // [internal] !!! DO NOT ADD TO THIS !!! See prior note.
}

export type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

export interface WorkerInfo {
  config: FullConfig;
  project: FullProject;
}

export interface TestInfo {
  config: FullConfig;
  project: FullProject;
}

interface SuiteFunction {
  (title: string, callback: () => void): void;
  (callback: () => void): void;
}

interface TestFunction<TestArgs> {
  (title: string, testFunction: (args: TestArgs, testInfo: TestInfo) => Promise<void> | void): void;
}

export interface TestType<TestArgs extends KeyValue, WorkerArgs extends KeyValue> extends TestFunction<TestArgs & WorkerArgs> {
  only: TestFunction<TestArgs & WorkerArgs>;
  describe: SuiteFunction & {
    only: SuiteFunction;
    skip: SuiteFunction;
    fixme: SuiteFunction;
    serial: SuiteFunction & {
      only: SuiteFunction;
    };
    parallel: SuiteFunction & {
      only: SuiteFunction;
    };
    configure: (options: { mode?: 'default' | 'parallel' | 'serial', retries?: number, timeout?: number }) => void;
  };
  skip(title: string, testFunction: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<void> | void): void;
  skip(): void;
  skip(condition: boolean, description?: string): void;
  skip(callback: (args: TestArgs & WorkerArgs) => boolean, description?: string): void;
  fixme(title: string, testFunction: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<void> | void): void;
  fixme(): void;
  fixme(condition: boolean, description?: string): void;
  fixme(callback: (args: TestArgs & WorkerArgs) => boolean, description?: string): void;
  fail(): void;
  fail(condition: boolean, description?: string): void;
  fail(callback: (args: TestArgs & WorkerArgs) => boolean, description?: string): void;
  slow(): void;
  slow(condition: boolean, description?: string): void;
  slow(callback: (args: TestArgs & WorkerArgs) => boolean, description?: string): void;
  setTimeout(timeout: number): void;
  beforeEach(inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  beforeEach(title: string, inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  afterEach(inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  afterEach(title: string, inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  beforeAll(inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  beforeAll(title: string, inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  afterAll(inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  afterAll(title: string, inner: (args: TestArgs & WorkerArgs, testInfo: TestInfo) => Promise<any> | any): void;
  use(fixtures: Fixtures<{}, {}, TestArgs, WorkerArgs>): void;
  step<T>(title: string, body: () => T | Promise<T>): Promise<T>;
  expect: Expect;
  extend<T extends KeyValue, W extends KeyValue = {}>(fixtures: Fixtures<T, W, TestArgs, WorkerArgs>): TestType<TestArgs & T, WorkerArgs & W>;
  info(): TestInfo;
}

type KeyValue = { [key: string]: any };
export type TestFixture<R, Args extends KeyValue> = (args: Args, use: (r: R) => Promise<void>, testInfo: TestInfo) => any;
export type WorkerFixture<R, Args extends KeyValue> = (args: Args, use: (r: R) => Promise<void>, workerInfo: WorkerInfo) => any;
type TestFixtureValue<R, Args extends KeyValue> = Exclude<R, Function> | TestFixture<R, Args>;
type WorkerFixtureValue<R, Args extends KeyValue> = Exclude<R, Function> | WorkerFixture<R, Args>;
export type Fixtures<T extends KeyValue = {}, W extends KeyValue = {}, PT extends KeyValue = {}, PW extends KeyValue = {}> = {
  [K in keyof PW]?: WorkerFixtureValue<PW[K], W & PW> | [WorkerFixtureValue<PW[K], W & PW>, { scope: 'worker', timeout?: number | undefined }];
} & {
  [K in keyof PT]?: TestFixtureValue<PT[K], T & W & PT & PW> | [TestFixtureValue<PT[K], T & W & PT & PW>, { scope: 'test', timeout?: number | undefined }];
} & {
  [K in keyof W]?: [WorkerFixtureValue<W[K], W & PW>, { scope: 'worker', auto?: boolean, option?: boolean, timeout?: number | undefined }];
} & {
  [K in keyof T]?: TestFixtureValue<T[K], T & W & PT & PW> | [TestFixtureValue<T[K], T & W & PT & PW>, { scope?: 'test', auto?: boolean, option?: boolean, timeout?: number | undefined }];
};

type BrowserName = 'chromium' | 'firefox' | 'webkit';
type BrowserChannel = Exclude<LaunchOptions['channel'], undefined>;
type ColorScheme = Exclude<BrowserContextOptions['colorScheme'], undefined>;
type ExtraHTTPHeaders = Exclude<BrowserContextOptions['extraHTTPHeaders'], undefined>;
type Proxy = Exclude<BrowserContextOptions['proxy'], undefined>;
type StorageState = Exclude<BrowserContextOptions['storageState'], undefined>;
type ServiceWorkerPolicy = Exclude<BrowserContextOptions['serviceWorkers'], undefined>;
type ConnectOptions = {
  /**
   * A browser websocket endpoint to connect to.
   */
  wsEndpoint: string;

  /**
   * Additional HTTP headers to be sent with web socket connect request.
   */
  headers?: { [key: string]: string; };

  /**
   * This option exposes network available on the connecting client to the browser being connected to.
   * Consists of a list of rules separated by comma.
   *
   * Available rules:
   * - Hostname pattern, for example: `example.com`, `*.org:99`, `x.*.y.com`, `*foo.org`.
   * - IP literal, for example: `127.0.0.1`, `0.0.0.0:99`, `[::1]`, `[0:0::1]:99`.
   * - `<loopback>` that matches local loopback interfaces: `localhost`, `*.localhost`, `127.0.0.1`, `[::1]`.

   * Some common examples:
   * - `"*"` to expose all network.
   * - `"<loopback>"` to expose localhost network.
   * - `"*.test.internal-domain,*.staging.internal-domain,<loopback>"` to expose test/staging deployments and localhost.
   */
  exposeNetwork?: string;

  /**
   * Timeout in milliseconds for the connection to be established. Optional, defaults to no timeout.
   */
  timeout?: number;
};

export interface PlaywrightWorkerOptions {
  browserName: BrowserName;
  defaultBrowserType: BrowserName;
  headless: boolean;
  channel: BrowserChannel | undefined;
  launchOptions: Omit<LaunchOptions, 'tracesDir'>;
  connectOptions: ConnectOptions | undefined;
  screenshot: ScreenshotMode | { mode: ScreenshotMode } & Pick<PageScreenshotOptions, 'fullPage' | 'omitBackground'>;
  trace: TraceMode | /** deprecated */ 'retry-with-trace' | { mode: TraceMode, snapshots?: boolean, screenshots?: boolean, sources?: boolean, attachments?: boolean };
  video: VideoMode | /** deprecated */ 'retry-with-video' | { mode: VideoMode, size?: ViewportSize };
}

export type ScreenshotMode = 'off' | 'on' | 'only-on-failure';
export type TraceMode = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry' | 'on-all-retries';
export type VideoMode = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry';

export interface PlaywrightTestOptions {
  acceptDownloads: boolean;
  bypassCSP: boolean;
  colorScheme: ColorScheme;
  deviceScaleFactor: number | undefined;
  extraHTTPHeaders: ExtraHTTPHeaders | undefined;
  geolocation: Geolocation | undefined;
  hasTouch: boolean;
  httpCredentials: HTTPCredentials | undefined;
  ignoreHTTPSErrors: boolean;
  isMobile: boolean;
  javaScriptEnabled: boolean;
  locale: string | undefined;
  offline: boolean;
  permissions: string[] | undefined;
  proxy: Proxy | undefined;
  storageState: StorageState | undefined;
  timezoneId: string | undefined;
  userAgent: string | undefined;
  viewport: ViewportSize | null;
  baseURL: string | undefined;
  contextOptions: BrowserContextOptions;
  actionTimeout: number;
  navigationTimeout: number;
  serviceWorkers: ServiceWorkerPolicy;
  testIdAttribute: string;
}


export interface PlaywrightWorkerArgs {
  playwright: typeof import('playwright-core');
  browser: Browser;
}

export interface PlaywrightTestArgs {
  context: BrowserContext;
  page: Page;
  request: APIRequestContext;
}

type ExcludeProps<A, B> = {
  [K in Exclude<keyof A, keyof B>]: A[K];
};
type CustomProperties<T> = ExcludeProps<T, PlaywrightTestOptions & PlaywrightWorkerOptions & PlaywrightTestArgs & PlaywrightWorkerArgs>;

export type PlaywrightTestProject<TestArgs = {}, WorkerArgs = {}> = Project<PlaywrightTestOptions & CustomProperties<TestArgs>, PlaywrightWorkerOptions & CustomProperties<WorkerArgs>>;
export type PlaywrightTestConfig<TestArgs = {}, WorkerArgs = {}> = Config<PlaywrightTestOptions & CustomProperties<TestArgs>, PlaywrightWorkerOptions & CustomProperties<WorkerArgs>>;

type AsymmetricMatcher = Record<string, any>;

interface AsymmetricMatchers {
  any(sample: unknown): AsymmetricMatcher;
  anything(): AsymmetricMatcher;
  arrayContaining(sample: Array<unknown>): AsymmetricMatcher;
  closeTo(sample: number, precision?: number): AsymmetricMatcher;
  objectContaining(sample: Record<string, unknown>): AsymmetricMatcher;
  stringContaining(sample: string): AsymmetricMatcher;
  stringMatching(sample: string | RegExp): AsymmetricMatcher;
}

interface GenericAssertionsSource<R> {
  toBe(receiver: any, expected: unknown): R;
  toBeCloseTo(receiver: number, expected: number, numDigits?: number): R;
  toBeDefined(receiver: any): R;
  toBeFalsy(receiver: any): R;
  toBeGreaterThan(receiver: number, expected: number | bigint): R;
  toBeGreaterThanOrEqual(receiver: number, expected: number | bigint): R;
  toBeInstanceOf(receiver: any, expected: Function): R;
  toBeLessThan(receiver: number, expected: number | bigint): R;
  toBeLessThanOrEqual(receiver: number, expected: number | bigint): R;
  toBeNaN(receiver: number): R;
  toBeNull(receiver: any): R;
  toBeTruthy(receiver: any): R;
  toBeUndefined(receiver: any): R;
  toContain(receiver: string, expected: string): R;
  toContain(receiver: Array<unknown>, expected: unknown): R;
  toContainEqual(receiver: Array<unknown>, expected: unknown): R;
  toEqual(receiver: any, expected: unknown): R;
  toHaveLength(receiver: string | Array<unknown>, expected: number): R;
  toHaveProperty(receiver: Record<string, unknown>, keyPath: string | Array<string>, value?: unknown): R;
  toMatch(receiver: string, expected: RegExp | string): R;
  toMatchObject(receiver: Record<string, unknown>, expected: Record<string, unknown> | Array<unknown>): R;
  toStrictEqual(receiver: any, expected: unknown): R;
  toThrow(receiver: Function, error?: unknown): R;
  toThrowError(receiver: Function, error?: unknown): R;
}

type TrimFirstArg<F> = F extends (a: any, ...args: infer Rest) => infer R ? (...args: Rest) => R : never;
type TrimFirstArgOf<T, ArgType> = T extends (arg: ArgType, ...rest: any[]) => any ? TrimFirstArg<T> : never;
type FilterMethodsByFirstArg<T, ArgType> = {
  [K in keyof T as T[K] extends (arg: ArgType, ...rest: any[]) => any ? K : never]: TrimFirstArgOf<T[K], ArgType>;
};
type GenericAssertions<R, T> = FilterMethodsByFirstArg<GenericAssertionsSource<R>, T>;

type FunctionAssertions = {
  /**
   * Retries the callback until it passes.
   */
  toPass(options?: { timeout?: number, intervals?: number[] }): Promise<void>;
};

type BaseMatchers<R, T> = GenericAssertions<R, T> & PlaywrightTest.Matchers<R, T> & SnapshotAssertions;
type AllowedGenericMatchers<R, T> = PlaywrightTest.Matchers<R, T> & GenericAssertions<R, T>;

type SpecificMatchers<R, T> =
  T extends Page ? PageAssertions & AllowedGenericMatchers<R, T> :
  T extends Locator ? LocatorAssertions & AllowedGenericMatchers<R, T> :
  T extends APIResponse ? APIResponseAssertions & AllowedGenericMatchers<R, T> :
  BaseMatchers<R, T> & (T extends Function ? FunctionAssertions : {});
type AllMatchers<R, T> = PageAssertions & LocatorAssertions & APIResponseAssertions & FunctionAssertions & BaseMatchers<R, T>;

type IfAny<T, Y, N> = 0 extends (1 & T) ? Y : N;
type Awaited<T> = T extends PromiseLike<infer U> ? U : T;
type MakeMatchers<R, T> = {
  /**
   * If you know how to test something, `.not` lets you test its opposite.
   */
  not: MakeMatchers<R, T>;
  /**
   * Use resolves to unwrap the value of a fulfilled promise so any other
   * matcher can be chained. If the promise is rejected the assertion fails.
   */
  resolves: MakeMatchers<Promise<R>, Awaited<T>>;
  /**
   * Unwraps the reason of a rejected promise so any other matcher can be chained.
   * If the promise is fulfilled the assertion fails.
   */
  rejects: MakeMatchers<Promise<R>, any>;
} & IfAny<T, AllMatchers<R, T>, SpecificMatchers<R, T>>;

export type Expect = {
  <T = unknown>(actual: T, messageOrOptions?: string | { message?: string }): MakeMatchers<void, T>;
  soft: <T = unknown>(actual: T, messageOrOptions?: string | { message?: string }) => MakeMatchers<void, T>;
  poll: <T = unknown>(actual: () => T | Promise<T>, messageOrOptions?: string | { message?: string, timeout?: number, intervals?: number[] }) => BaseMatchers<Promise<void>, T> & {
    /**
     * If you know how to test something, `.not` lets you test its opposite.
     */
     not: BaseMatchers<Promise<void>, T>;
  };
  extend(matchers: any): void;
  configure: (configuration: {
    message?: string,
    timeout?: number,
    soft?: boolean,
  }) => Expect;
  getState(): {
    expand?: boolean;
    isNot?: boolean;
    promise?: string;
    utils: any;
  };
  not: Omit<AsymmetricMatchers, 'any' | 'anything'>;
} & AsymmetricMatchers;

// --- BEGINGLOBAL ---
declare global {
  export namespace PlaywrightTest {
    export interface Matchers<R, T = unknown> {
    }
  }
}
// --- ENDGLOBAL ---

/**
 * These tests are executed in Playwright environment that launches the browser
 * and provides a fresh page to each test.
 */
export const test: TestType<PlaywrightTestArgs & PlaywrightTestOptions, PlaywrightWorkerArgs & PlaywrightWorkerOptions>;
export default test;

export const _baseTest: TestType<{}, {}>;
export const expect: Expect;

/**
 * Defines Playwright config
 */
export function defineConfig(config: PlaywrightTestConfig): PlaywrightTestConfig;
export function defineConfig<T>(config: PlaywrightTestConfig<T>): PlaywrightTestConfig<T>;
export function defineConfig<T, W>(config: PlaywrightTestConfig<T, W>): PlaywrightTestConfig<T, W>;
export function defineConfig(config: PlaywrightTestConfig, ...configs: PlaywrightTestConfig[]): PlaywrightTestConfig;
export function defineConfig<T>(config: PlaywrightTestConfig<T>, ...configs: PlaywrightTestConfig[]): PlaywrightTestConfig<T>;
export function defineConfig<T, W>(config: PlaywrightTestConfig<T, W>, ...configs: PlaywrightTestConfig[]): PlaywrightTestConfig<T, W>;

// This is required to not export everything by default. See https://github.com/Microsoft/TypeScript/issues/19545#issuecomment-340490459
export {};
