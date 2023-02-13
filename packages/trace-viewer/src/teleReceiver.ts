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

import type { FullConfig, FullResult, Location, Reporter, TestError, TestResult, TestStatus, TestStep } from '../../playwright-test/types/testReporter';
import type { Annotation, FullProject, Metadata } from '../../playwright-test/src/common/types';
import type * as reporterTypes from '../../playwright-test/types/testReporter';

export type JsonLocation = Location;
export type JsonError = string;
export type JsonStackFrame = { file: string, line: number, column: number };

export type JsonConfig = {
  rootDir: string;
  configFile: string | undefined;
};

export type JsonProject = {
  id: string;
  grep: string[];
  grepInvert: string[];
  metadata: Metadata;
  name: string;
  dependencies: string[];
  snapshotDir: string;
  outputDir: string;
  repeatEach: number;
  retries: number;
  suites: JsonSuite[];
  testDir: string;
  testIgnore: string[];
  testMatch: string[];
  timeout: number;
};

export type JsonSuite = {
  type: 'root' | 'project' | 'file' | 'describe';
  fileId: string;
  title: string;
  location?: JsonLocation;
  suites: JsonSuite[];
  tests: JsonTestCase[];
};

export type JsonTestCase = {
  testId: string;
  title: string;
  location: JsonLocation;
  expectedStatus: TestStatus;
  timeout: number;
  annotations: { type: string, description?: string }[];
  retries: number;
};

export type JsonTestResultStart = {
  id: string;
  retry: number;
  workerIndex: number;
  parallelIndex: number;
  startTime: string;
};

export type JsonTestResultEnd = {
  id: string;
  duration: number;
  status: TestStatus;
  errors: TestError[];
  attachments: TestResult['attachments'];
};

export type JsonTestStepStart = {
  id: string;
  title: string;
  category: string,
  startTime: string;
  location?: Location;
};

export type JsonTestStepEnd = {
  id: string;
  duration: number;
  error?: TestError;
};

export class TeleReporterReceiver {
  private _rootSuite: TeleSuite;
  private _reporter: Reporter;
  private _tests = new Map<string, TeleTestCase>();

  constructor(reporter: Reporter) {
    this._rootSuite = new TeleSuite('', 'root');
    this._reporter = reporter;
  }

  dispatch(message: any) {
    const { method, params }: { method: string, params: any } = message;
    if (method === 'onBegin') {
      this._onBegin(params.config, params.projects);
      return;
    }
    if (method === 'onTestBegin') {
      this._onTestBegin(params.testId, params.result);
      return;
    }
    if (method === 'onTestEnd') {
      this._onTestEnd(params.testId, params.result);
      return;
    }
    if (method === 'onStepBegin') {
      this._onStepBegin(params.testId, params.resultId, params.step);
      return;
    }
    if (method === 'onStepEnd') {
      this._onStepEnd(params.testId, params.resultId, params.step);
      return;
    }
    if (method === 'onError') {
      this._onError(params.error);
      return;
    }
    if (method === 'onStdIO') {
      this._onStdIO(params.type, params.testId, params.resultId, params.data, params.isBase64);
      return;
    }
    if (method === 'onEnd') {
      this._onEnd(params.result);
      return;
    }
  }

  private _onBegin(config: JsonConfig, projects: JsonProject[]) {
    for (const project of projects) {
      let projectSuite = this._rootSuite.suites.find(suite => suite.project()!.id === project.id);
      if (!projectSuite) {
        projectSuite = new TeleSuite(project.name, 'project');
        this._rootSuite.suites.push(projectSuite);
      }
      const p = this._parseProject(project);
      projectSuite.project = () => p;
      this._updateSuites(project.suites, projectSuite.suites);
    }
    this._reporter.onBegin?.(this._parseConfig(config), this._rootSuite);
  }

  private _onTestBegin(testId: string, payload: JsonTestResultStart) {
    const test = this._tests.get(testId)!;
    test.results = [];
    test.resultsMap.clear();
    const testResult = test._appendTestResult(payload.id);
    testResult.retry = payload.retry;
    testResult.workerIndex = payload.workerIndex;
    testResult.parallelIndex = payload.parallelIndex;
    testResult.startTime = new Date(payload.startTime);
    this._reporter.onTestBegin?.(test, testResult);
  }

  private _onTestEnd(testId: string, payload: JsonTestResultEnd) {
    const test = this._tests.get(testId)!;
    const result = test.resultsMap.get(payload.id)!;
    result.duration = payload.duration;
    result.status = payload.status;
    result.errors = payload.errors;
    result.attachments = payload.attachments;
    this._reporter.onTestEnd?.(test, result);
  }

  private _onStepBegin(testId: string, resultId: string, payload: JsonTestStepStart) {
    const test = this._tests.get(testId)!;
    const result = test.resultsMap.get(resultId)!;
    const step: TestStep = {
      titlePath: () => [],
      title: payload.title,
      category: payload.category,
      location: payload.location,
      startTime: new Date(payload.startTime),
      duration: 0,
      steps: [],
    };
    (step as any).id = payload.id;
    // TODO: implement nested steps.
    result.stepMap.set(payload.id, step);
    result.stepStack[result.stepStack.length - 1].steps.push(step);
    result.stepStack.push(step);
    this._reporter.onStepBegin?.(test, result, step);
  }

  private _onStepEnd(testId: string, resultId: string, payload: JsonTestStepEnd) {
    const test = this._tests.get(testId)!;
    const result = test.resultsMap.get(resultId)!;
    const step = result.stepMap.get(payload.id)!;
    const i = result.stepStack.indexOf(step);
    if (i !== -1)
      result.stepStack.splice(i, 1);
    step.duration = payload.duration;
    step.error = payload.error;
    this._reporter.onStepEnd?.(test, result, step);
  }

  private _onError(error: TestError) {
    this._reporter.onError?.(error);
  }

  private _onStdIO(type: 'stdout' | 'stderr', testId: string | undefined, resultId: string | undefined, data: string, isBase64: boolean) {
    const chunk = isBase64 ? Buffer.from(data, 'base64') : data;
    const test = testId ? this._tests.get(testId) : undefined;
    const result = test && resultId ? test.resultsMap.get(resultId) : undefined;
    if (type === 'stdout')
      this._reporter.onStdOut?.(chunk, test, result);
    else
      this._reporter.onStdErr?.(chunk, test, result);
  }

  private _onEnd(result: FullResult) {
    this._reporter.onEnd?.(result);
  }

  private _parseConfig(config: JsonConfig): FullConfig {
    const fullConfig = baseFullConfig;
    fullConfig.rootDir = config.rootDir;
    fullConfig.configFile = config.configFile;
    return fullConfig;
  }

  private _parseProject(project: JsonProject): TeleFullProject {
    return {
      id: project.id,
      metadata: project.metadata,
      name: project.name,
      outputDir: project.outputDir,
      repeatEach: project.repeatEach,
      retries: project.retries,
      testDir: project.testDir,
      testIgnore: project.testIgnore,
      testMatch: project.testMatch,
      timeout: project.timeout,
      grep: project.grep.map(p => new RegExp(p)),
      grepInvert: project.grepInvert.map(p => new RegExp(p)),
      dependencies: project.dependencies,
      snapshotDir: project.snapshotDir,
      use: {},
    };
  }

  private _updateSuites(jsonSuites: JsonSuite[], suites: TeleSuite[]) {
    for (const jsonSuite of jsonSuites) {
      let targetSuite = suites.find(s => s.title === jsonSuite.title);
      if (!targetSuite) {
        targetSuite = new TeleSuite(jsonSuite.title, jsonSuite.type);
        suites.push(targetSuite);
      }
      this._updateSuite(jsonSuite, targetSuite);
    }
  }

  private _updateSuite(payload: JsonSuite, suite: TeleSuite) {
    suite.location = payload.location;
    suite._fileId = payload.fileId;
    this._updateSuites(payload.suites, suite.suites);
    this._updateTests(payload.tests, suite.tests);
    return suite;
  }

  private _updateTests(jsonTests: JsonTestCase[], tests: TeleTestCase[]) {
    for (const jsonTest of jsonTests) {
      let targetTest = tests.find(s => s.title === jsonTest.title);
      if (!targetTest) {
        targetTest = new TeleTestCase(jsonTest.testId, jsonTest.title, jsonTest.location);
        tests.push(targetTest);
        this._tests.set(targetTest.id, targetTest);
      }
      this._updateTest(jsonTest, targetTest);
    }
  }

  private _updateTest(payload: JsonTestCase, test: TeleTestCase): TeleTestCase {
    test.id = payload.testId;
    test.expectedStatus = payload.expectedStatus;
    test.timeout = payload.timeout;
    test.annotations = payload.annotations;
    test.retries = payload.retries;
    return test;
  }
}

export class TeleSuite implements reporterTypes.Suite {
  title: string;
  location?: Location;
  parent?: TeleSuite;
  _requireFile: string = '';
  suites: TeleSuite[] = [];
  tests: TeleTestCase[] = [];
  _timeout: number | undefined;
  _retries: number | undefined;
  _fileId: string | undefined;
  readonly _type: 'root' | 'project' | 'file' | 'describe';

  constructor(title: string, type: 'root' | 'project' | 'file' | 'describe') {
    this.title = title;
    this._type = type;
  }

  allTests(): TeleTestCase[] {
    const result: TeleTestCase[] = [];
    const visit = (suite: TeleSuite) => {
      for (const entry of [...suite.suites, ...suite.tests]) {
        if (entry instanceof TeleSuite)
          visit(entry);
        else
          result.push(entry);
      }
    };
    visit(this);
    return result;
  }

  titlePath(): string[] {
    const titlePath = this.parent ? this.parent.titlePath() : [];
    // Ignore anonymous describe blocks.
    if (this.title || this._type !== 'describe')
      titlePath.push(this.title);
    return titlePath;
  }

  project(): TeleFullProject | undefined {
    return undefined;
  }
}

export class TeleTestCase implements reporterTypes.TestCase {
  title: string;
  fn = () => {};
  results: reporterTypes.TestResult[] = [];
  location: Location;
  parent!: TeleSuite;

  expectedStatus: reporterTypes.TestStatus = 'passed';
  timeout = 0;
  annotations: Annotation[] = [];
  retries = 0;
  repeatEachIndex = 0;
  id: string;

  resultsMap = new Map<string, TeleTestResult>();

  constructor(id: string, title: string, location: Location) {
    this.id = id;
    this.title = title;
    this.location = location;
  }

  titlePath(): string[] {
    const titlePath = this.parent ? this.parent.titlePath() : [];
    titlePath.push(this.title);
    return titlePath;
  }

  outcome(): 'skipped' | 'expected' | 'unexpected' | 'flaky' {
    const nonSkipped = this.results.filter(result => result.status !== 'skipped' && result.status !== 'interrupted');
    if (!nonSkipped.length)
      return 'skipped';
    if (nonSkipped.every(result => result.status === this.expectedStatus))
      return 'expected';
    if (nonSkipped.some(result => result.status === this.expectedStatus))
      return 'flaky';
    return 'unexpected';
  }

  ok(): boolean {
    const status = this.outcome();
    return status === 'expected' || status === 'flaky' || status === 'skipped';
  }

  _appendTestResult(id: string): reporterTypes.TestResult {
    const result: TeleTestResult = {
      retry: this.results.length,
      parallelIndex: -1,
      workerIndex: -1,
      duration: 0,
      startTime: new Date(),
      stdout: [],
      stderr: [],
      attachments: [],
      status: 'skipped',
      steps: [],
      errors: [],
      stepMap: new Map(),
      stepStack: [],
    };
    result.stepStack.push(result);
    this.results.push(result);
    this.resultsMap.set(id, result);
    return result;
  }
}

export type TeleTestResult = reporterTypes.TestResult & {
  stepMap: Map<string, reporterTypes.TestStep>;
  stepStack: (reporterTypes.TestStep | reporterTypes.TestResult)[];
};

export type TeleFullProject = FullProject & { id: string };

export const baseFullConfig: FullConfig = {
  forbidOnly: false,
  fullyParallel: false,
  globalSetup: null,
  globalTeardown: null,
  globalTimeout: 0,
  grep: /.*/,
  grepInvert: null,
  maxFailures: 0,
  metadata: {},
  preserveOutput: 'always',
  projects: [],
  reporter: [[process.env.CI ? 'dot' : 'list']],
  reportSlowTests: { max: 5, threshold: 15000 },
  configFile: '',
  rootDir: '',
  quiet: false,
  shard: null,
  updateSnapshots: 'missing',
  version: '',
  workers: 0,
  webServer: null,
};
