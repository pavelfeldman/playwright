/**
 * Copyright Microsoft Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import fs from 'fs';
import path from 'path';
import { MaxTime, captureRawStack, monotonicTime, zones, sanitizeForFilePath, stringifyStackFrames } from 'playwright-core/lib/utils';
import type { TestInfoError, TestInfo, TestStatus, FullProject, FullConfig } from '../../types/test';
import type { AttachmentPayload, StepBeginPayload, StepEndPayload, WorkerInitParams } from '../common/ipc';
import type { TestCase } from '../common/test';
import { TimeoutManager } from './timeoutManager';
import type { RunnableType, TimeSlot } from './timeoutManager';
import type { Annotation, FullConfigInternal, FullProjectInternal } from '../common/config';
import type { Location } from '../../types/testReporter';
import { filteredStackTrace, getContainedPath, normalizeAndSaveAttachment, serializeError, trimLongString } from '../util';
import { TestTracing } from './testTracing';
import type { Attachment } from './testTracing';
import type { StackFrame } from '@protocol/channels';

export interface TestStepInternal {
  complete(result: { error?: Error, attachments?: Attachment[] }): void;
  stepId: string;
  title: string;
  category: 'hook' | 'fixture' | 'test.step' | string;
  wallTime: number;
  location?: Location;
  boxedStack?: StackFrame[];
  steps: TestStepInternal[];
  endWallTime?: number;
  apiName?: string;
  params?: Record<string, any>;
  error?: TestInfoError;
  infectParentStepsWithError?: boolean;
  box?: boolean;
  isSoft?: boolean;
  forceNoParent?: boolean;
}

export class TestInfoImpl implements TestInfo {
  private _onStepBegin: (payload: StepBeginPayload) => void;
  private _onStepEnd: (payload: StepEndPayload) => void;
  private _onAttach: (payload: AttachmentPayload) => void;
  readonly _timeoutManager: TimeoutManager;
  readonly _startTime: number;
  readonly _startWallTime: number;
  private _hasHardError: boolean = false;
  readonly _tracing: TestTracing;

  _didTimeout = false;
  _wasInterrupted = false;
  _lastStepId = 0;
  private readonly _requireFile: string;
  readonly _projectInternal: FullProjectInternal;
  readonly _configInternal: FullConfigInternal;
  readonly _steps: TestStepInternal[] = [];
  _onDidFinishTestFunction: (() => Promise<void>) | undefined;

  _hasNonRetriableError = false;

  // ------------ TestInfo fields ------------
  readonly testId: string;
  readonly repeatEachIndex: number;
  readonly retry: number;
  readonly workerIndex: number;
  readonly parallelIndex: number;
  readonly project: FullProject;
  readonly config: FullConfig;
  readonly title: string;
  readonly titlePath: string[];
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly fn: Function;
  expectedStatus: TestStatus;
  duration: number = 0;
  readonly annotations: Annotation[] = [];
  readonly attachments: TestInfo['attachments'] = [];
  status: TestStatus = 'passed';
  snapshotSuffix: string = '';
  readonly outputDir: string;
  readonly snapshotDir: string;
  errors: TestInfoError[] = [];
  readonly _attachmentsPush: (...items: TestInfo['attachments']) => number;

  get error(): TestInfoError | undefined {
    return this.errors[0];
  }

  set error(e: TestInfoError | undefined) {
    if (e === undefined)
      throw new Error('Cannot assign testInfo.error undefined value!');
    this.errors[0] = e;
  }

  get timeout(): number {
    return this._timeoutManager.defaultSlotTimings().timeout;
  }

  set timeout(timeout: number) {
    // Ignored.
  }

  _deadlineForMatcher(timeout: number): { deadline: number, timeoutMessage: string } {
    const startTime = monotonicTime();
    const matcherDeadline = timeout ? startTime + timeout : MaxTime;
    const testDeadline = this._timeoutManager.currentSlotDeadline() - 250;
    const matcherMessage = `Timeout ${timeout}ms exceeded while waiting on the predicate`;
    const testMessage = `Test timeout of ${this.timeout}ms exceeded`;
    return { deadline: Math.min(testDeadline, matcherDeadline), timeoutMessage: testDeadline < matcherDeadline ? testMessage : matcherMessage };
  }

  static _defaultDeadlineForMatcher(timeout: number): { deadline: any; timeoutMessage: any; } {
    return { deadline: (timeout ? monotonicTime() + timeout : 0), timeoutMessage: `Timeout ${timeout}ms exceeded while waiting on the predicate` };
  }

  constructor(
    configInternal: FullConfigInternal,
    projectInternal: FullProjectInternal,
    workerParams: WorkerInitParams,
    test: TestCase | undefined,
    retry: number,
    onStepBegin: (payload: StepBeginPayload) => void,
    onStepEnd: (payload: StepEndPayload) => void,
    onAttach: (payload: AttachmentPayload) => void,
  ) {
    this.testId = test?.id ?? '';
    this._onStepBegin = onStepBegin;
    this._onStepEnd = onStepEnd;
    this._onAttach = onAttach;
    this._startTime = monotonicTime();
    this._startWallTime = Date.now();
    this._requireFile = test?._requireFile ?? '';

    this.repeatEachIndex = workerParams.repeatEachIndex;
    this.retry = retry;
    this.workerIndex = workerParams.workerIndex;
    this.parallelIndex =  workerParams.parallelIndex;
    this._projectInternal = projectInternal;
    this.project = projectInternal.project;
    this._configInternal = configInternal;
    this.config = configInternal.config;
    this.title = test?.title ?? '';
    this.titlePath = test?.titlePath() ?? [];
    this.file = test?.location.file ?? '';
    this.line = test?.location.line ?? 0;
    this.column = test?.location.column ?? 0;
    this.fn = test?.fn ?? (() => {});
    this.expectedStatus = test?.expectedStatus ?? 'skipped';

    this._timeoutManager = new TimeoutManager(this.project.timeout);

    this.outputDir = (() => {
      const relativeTestFilePath = path.relative(this.project.testDir, this._requireFile.replace(/\.(spec|test)\.(js|ts|mjs)$/, ''));
      const sanitizedRelativePath = relativeTestFilePath.replace(process.platform === 'win32' ? new RegExp('\\\\', 'g') : new RegExp('/', 'g'), '-');
      const fullTitleWithoutSpec = this.titlePath.slice(1).join(' ');

      let testOutputDir = trimLongString(sanitizedRelativePath + '-' + sanitizeForFilePath(fullTitleWithoutSpec));
      if (projectInternal.project.name)
        testOutputDir += '-' + sanitizeForFilePath(projectInternal.project.name);
      if (this.retry)
        testOutputDir += '-retry' + this.retry;
      if (this.repeatEachIndex)
        testOutputDir += '-repeat' + this.repeatEachIndex;
      return path.join(this.project.outputDir, testOutputDir);
    })();

    this.snapshotDir = (() => {
      const relativeTestFilePath = path.relative(this.project.testDir, this._requireFile);
      return path.join(this.project.snapshotDir, relativeTestFilePath + '-snapshots');
    })();

    this._attachmentsPush = this.attachments.push.bind(this.attachments);
    this.attachments.push = (...attachments: TestInfo['attachments']) => {
      for (const a of attachments)
        this._attach(a.name, a);
      return this.attachments.length;
    };

    this._tracing = new TestTracing(this, workerParams.artifactsDir);
  }

  private _modifier(type: 'skip' | 'fail' | 'fixme' | 'slow', modifierArgs: [arg?: any, description?: string]) {
    if (typeof modifierArgs[1] === 'function') {
      throw new Error([
        'It looks like you are calling test.skip() inside the test and pass a callback.',
        'Pass a condition instead and optional description instead:',
        `test('my test', async ({ page, isMobile }) => {`,
        `  test.skip(isMobile, 'This test is not applicable on mobile');`,
        `});`,
      ].join('\n'));
    }

    if (modifierArgs.length >= 1 && !modifierArgs[0])
      return;

    const description = modifierArgs[1];
    this.annotations.push({ type, description });
    if (type === 'slow') {
      this._timeoutManager.slow();
    } else if (type === 'skip' || type === 'fixme') {
      this.expectedStatus = 'skipped';
      throw new SkipError('Test is skipped: ' + (description || ''));
    } else if (type === 'fail') {
      if (this.expectedStatus !== 'skipped')
        this.expectedStatus = 'failed';
    }
  }

  async _runWithTimeout(cb: () => Promise<any>): Promise<void> {
    const timeoutError = await this._timeoutManager.runWithTimeout(cb);
    // When interrupting, we arrive here with a timeoutError, but we should not
    // consider it a timeout.
    if (!this._wasInterrupted && timeoutError && !this._didTimeout) {
      this._didTimeout = true;
      const serialized = serializeError(timeoutError);
      this.errors.push(serialized);
      this._tracing.appendForError(serialized);
      // Do not overwrite existing failure upon hook/teardown timeout.
      if (this.status === 'passed' || this.status === 'skipped')
        this.status = 'timedOut';
    }
    this.duration = this._timeoutManager.defaultSlotTimings().elapsed | 0;
  }

  async _runAndFailOnError(fn: () => Promise<void>, skips?: 'allowSkips'): Promise<Error | undefined> {
    try {
      await fn();
    } catch (error) {
      if (skips === 'allowSkips' && error instanceof SkipError) {
        if (this.status === 'passed')
          this.status = 'skipped';
      } else {
        this._failWithError(error, true /* isHardError */, true /* retriable */);
        return error;
      }
    }
  }

  private _findLastNonFinishedStep(filter: (step: TestStepInternal) => boolean) {
    let result: TestStepInternal | undefined;
    const visit = (step: TestStepInternal) => {
      if (!step.endWallTime && filter(step))
        result = step;
      step.steps.forEach(visit);
    };
    this._steps.forEach(visit);
    return result;
  }

  _addStep(data: Omit<TestStepInternal, 'complete' | 'stepId' | 'steps'>): TestStepInternal {
    const stepId = `${data.category}@${++this._lastStepId}`;
    const rawStack = captureRawStack();

    let parentStep: TestStepInternal | undefined;
    if (data.category === 'hook' || data.category === 'fixture') {
      // Predefined steps form a fixed hierarchy - find the last non-finished one.
      parentStep = this._findLastNonFinishedStep(step => step.category === 'fixture' || step.category === 'hook');
    } else {
      parentStep = zones.zoneData<TestStepInternal>('stepZone', rawStack!) || undefined;
      if (parentStep?.category === 'hook' || parentStep?.category === 'fixture') {
        // Prefer last non-finished predefined step over the on-stack one, because
        // some predefined steps may be missing on the stack.
        parentStep = this._findLastNonFinishedStep(step => step.category === 'fixture' || step.category === 'hook');
      } else if (!parentStep) {
        if (data.category === 'test.step') {
          // Nest test.step without a good stack in the last non-finished predefined step like a hook.
          parentStep = this._findLastNonFinishedStep(step => step.category === 'fixture' || step.category === 'hook');
        } else {
          // Do not nest chains of route.continue.
          parentStep = this._findLastNonFinishedStep(step => step.title !== data.title);
        }
      }
    }
    if (data.forceNoParent) {
      // This is used to reset step hierarchy after test timeout.
      parentStep = undefined;
    }

    const filteredStack = filteredStackTrace(rawStack);
    data.boxedStack = parentStep?.boxedStack;
    if (!data.boxedStack && data.box) {
      data.boxedStack = filteredStack.slice(1);
      data.location = data.location || data.boxedStack[0];
    }
    data.location = data.location || filteredStack[0];

    const step: TestStepInternal = {
      stepId,
      ...data,
      steps: [],
      complete: result => {
        if (step.endWallTime)
          return;

        step.endWallTime = Date.now();
        if (result.error) {
          if (!(result.error as any)[stepSymbol])
            (result.error as any)[stepSymbol] = step;
          const error = serializeError(result.error);
          if (data.boxedStack)
            error.stack = `${error.message}\n${stringifyStackFrames(data.boxedStack).join('\n')}`;
          step.error = error;
        }

        if (!step.error) {
          // Soft errors inside try/catch will make the test fail.
          // In order to locate the failing step, we are marking all the parent
          // steps as failing unconditionally.
          for (const childStep of step.steps) {
            if (childStep.error && childStep.infectParentStepsWithError) {
              step.error = childStep.error;
              step.infectParentStepsWithError = true;
              break;
            }
          }
        }

        const payload: StepEndPayload = {
          testId: this.testId,
          stepId,
          wallTime: step.endWallTime,
          error: step.error,
        };
        this._onStepEnd(payload);
        const errorForTrace = step.error ? { name: '', message: step.error.message || '', stack: step.error.stack } : undefined;
        this._tracing.appendAfterActionForStep(stepId, errorForTrace, result.attachments);

        if (step.isSoft && result.error)
          this._failWithError(result.error, false /* isHardError */, true /* retriable */);
      }
    };
    const parentStepList = parentStep ? parentStep.steps : this._steps;
    parentStepList.push(step);
    const payload: StepBeginPayload = {
      testId: this.testId,
      stepId,
      parentStepId: parentStep ? parentStep.stepId : undefined,
      title: data.title,
      category: data.category,
      wallTime: data.wallTime,
      location: data.location,
    };
    this._onStepBegin(payload);
    this._tracing.appendBeforeActionForStep(stepId, parentStep?.stepId, data.apiName || data.title, data.params, data.wallTime, data.location ? [data.location] : []);
    return step;
  }

  _interrupt() {
    // Mark as interrupted so we can ignore TimeoutError thrown by interrupt() call.
    this._wasInterrupted = true;
    this._timeoutManager.interrupt();
    // Do not overwrite existing failure (for example, unhandled rejection) with "interrupted".
    if (this.status === 'passed')
      this.status = 'interrupted';
  }

  _failWithError(error: Error, isHardError: boolean, retriable: boolean) {
    if (!retriable)
      this._hasNonRetriableError = true;
    // Do not overwrite any previous hard errors.
    // Some (but not all) scenarios include:
    //   - expect() that fails after uncaught exception.
    //   - fail after the timeout, e.g. due to fixture teardown.
    if (isHardError && this._hasHardError)
      return;
    if (isHardError)
      this._hasHardError = true;
    if (this.status === 'passed' || this.status === 'skipped')
      this.status = 'failed';
    const serialized = serializeError(error);
    const step = (error as any)[stepSymbol] as TestStepInternal | undefined;
    if (step && step.boxedStack)
      serialized.stack = `${error.name}: ${error.message}\n${stringifyStackFrames(step.boxedStack).join('\n')}`;
    this.errors.push(serialized);
    this._tracing.appendForError(serialized);
  }

  async _runAsStepWithRunnable<T>(
    stepInfo: Omit<TestStepInternal, 'complete' | 'wallTime' | 'parentStepId' | 'stepId' | 'steps'> & {
      wallTime?: number,
      runnableType: RunnableType;
      runnableSlot?: TimeSlot;
    }, cb: (step: TestStepInternal) => Promise<T>): Promise<T> {
    return await this._timeoutManager.withRunnable({
      type: stepInfo.runnableType,
      slot: stepInfo.runnableSlot,
      location: stepInfo.location,
    }, async () => {
      return await this._runAsStep(stepInfo, cb);
    });
  }

  async _runAsStep<T>(stepInfo: Omit<TestStepInternal, 'complete' | 'wallTime' | 'parentStepId' | 'stepId' | 'steps'> & { wallTime?: number }, cb: (step: TestStepInternal) => Promise<T>): Promise<T> {
    const step = this._addStep({ wallTime: Date.now(), ...stepInfo });
    return await zones.run('stepZone', step, async () => {
      try {
        const result = await cb(step);
        step.complete({});
        return result;
      } catch (e) {
        step.complete({ error: e instanceof SkipError ? undefined : e });
        throw e;
      }
    });
  }

  _isFailure() {
    return this.status !== 'skipped' && this.status !== this.expectedStatus;
  }

  // ------------ TestInfo methods ------------

  async attach(name: string, options: { path?: string, body?: string | Buffer, contentType?: string } = {}) {
    this._attach(name, await normalizeAndSaveAttachment(this.outputPath(), name, options));
  }

  private _attach(name: string, attachment: TestInfo['attachments'][0]) {
    const step = this._addStep({
      title: `attach "${name}"`,
      category: 'attach',
      wallTime: Date.now(),
    });
    this._attachmentsPush(attachment);
    this._onAttach({
      testId: this.testId,
      name: attachment.name,
      contentType: attachment.contentType,
      path: attachment.path,
      body: attachment.body?.toString('base64')
    });
    step.complete({ attachments: [attachment] });
  }

  outputPath(...pathSegments: string[]){
    const outputPath = this._getOutputPath(...pathSegments);
    fs.mkdirSync(this.outputDir, { recursive: true });
    return outputPath;
  }

  _getOutputPath(...pathSegments: string[]){
    const joinedPath = path.join(...pathSegments);
    const outputPath = getContainedPath(this.outputDir, joinedPath);
    if (outputPath)
      return outputPath;
    throw new Error(`The outputPath is not allowed outside of the parent directory. Please fix the defined path.\n\n\toutputPath: ${joinedPath}`);
  }

  _fsSanitizedTestName() {
    const fullTitleWithoutSpec = this.titlePath.slice(1).join(' ');
    return sanitizeForFilePath(trimLongString(fullTitleWithoutSpec));
  }

  snapshotPath(...pathSegments: string[]) {
    const subPath = path.join(...pathSegments);
    const parsedSubPath = path.parse(subPath);
    const relativeTestFilePath = path.relative(this.project.testDir, this._requireFile);
    const parsedRelativeTestFilePath = path.parse(relativeTestFilePath);
    const projectNamePathSegment = sanitizeForFilePath(this.project.name);

    const snapshotPath = (this._projectInternal.snapshotPathTemplate || '')
        .replace(/\{(.)?testDir\}/g, '$1' + this.project.testDir)
        .replace(/\{(.)?snapshotDir\}/g, '$1' + this.project.snapshotDir)
        .replace(/\{(.)?snapshotSuffix\}/g, this.snapshotSuffix ? '$1' + this.snapshotSuffix : '')
        .replace(/\{(.)?testFileDir\}/g, '$1' + parsedRelativeTestFilePath.dir)
        .replace(/\{(.)?platform\}/g, '$1' + process.platform)
        .replace(/\{(.)?projectName\}/g, projectNamePathSegment ? '$1' + projectNamePathSegment : '')
        .replace(/\{(.)?testName\}/g, '$1' + this._fsSanitizedTestName())
        .replace(/\{(.)?testFileName\}/g, '$1' + parsedRelativeTestFilePath.base)
        .replace(/\{(.)?testFilePath\}/g, '$1' + relativeTestFilePath)
        .replace(/\{(.)?arg\}/g, '$1' + path.join(parsedSubPath.dir, parsedSubPath.name))
        .replace(/\{(.)?ext\}/g, parsedSubPath.ext ? '$1' + parsedSubPath.ext : '');

    return path.normalize(path.resolve(this._configInternal.configDir, snapshotPath));
  }

  skip(...args: [arg?: any, description?: string]) {
    this._modifier('skip', args);
  }

  fixme(...args: [arg?: any, description?: string]) {
    this._modifier('fixme', args);
  }

  fail(...args: [arg?: any, description?: string]) {
    this._modifier('fail', args);
  }

  slow(...args: [arg?: any, description?: string]) {
    this._modifier('slow', args);
  }

  setTimeout(timeout: number) {
    this._timeoutManager.setTimeout(timeout);
  }
}

class SkipError extends Error {
}

const stepSymbol = Symbol('step');
