/**
 * Copyright (c) Microsoft Corporation.
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
import yazl from 'yazl';
import { EventEmitter } from 'events';
import { createGuid, mkdirIfNeeded, monotonicTime } from '../../../utils/utils';
import { Artifact } from '../../artifact';
import { BrowserContext } from '../../browserContext';
import { ElementHandle } from '../../dom';
import { eventsHelper, RegisteredListener } from '../../../utils/eventsHelper';
import { CallMetadata, InstrumentationListener, SdkObject } from '../../instrumentation';
import { Page } from '../../page';
import * as trace from '../common/traceEvents';
import { commandsWithTracingSnapshots } from '../../../protocol/channels';
import { Snapshotter, SnapshotterBlob, SnapshotterDelegate } from './snapshotter';
import { FrameSnapshot } from '../common/snapshotTypes';
import { HarTracer, HarTracerDelegate } from '../../supplements/har/harTracer';
import * as har from '../../supplements/har/har';
import { VERSION } from '../common/traceEvents';

export type TracerOptions = {
  name?: string;
  snapshots?: boolean;
  screenshots?: boolean;
};

type RecordingState = {
  options: TracerOptions,
  traceName: string,
  networkFile: string,
  traceFile: string,
  filesCount: number,
  sha1s: Set<string>,
  recording: boolean;
};

const kScreencastOptions = { width: 800, height: 600, quality: 90 };

export class Tracing implements InstrumentationListener, SnapshotterDelegate, HarTracerDelegate {
  private _writeChain = Promise.resolve();
  private _snapshotter: Snapshotter;
  private _harTracer: HarTracer;
  private _screencastListeners: RegisteredListener[] = [];
  private _pendingCalls = new Map<string, { sdkObject: SdkObject, metadata: CallMetadata, beforeSnapshot: Promise<void>, actionSnapshot?: Promise<void>, afterSnapshot?: Promise<void> }>();
  private _context: BrowserContext;
  private _resourcesDir: string;
  private _state: RecordingState | undefined;
  private _isStopping = false;
  private _tracesDir: string;
  private _allResources = new Set<string>();
  private _contextCreatedEvent: trace.ContextCreatedTraceEvent;

  constructor(context: BrowserContext) {
    this._context = context;
    this._tracesDir = context._browser.options.tracesDir;
    this._resourcesDir = path.join(this._tracesDir, 'resources');
    this._snapshotter = new Snapshotter(context, this);
    this._harTracer = new HarTracer(context, this, {
      content: 'sha1',
      waitForContentOnStop: false,
      skipScripts: true,
    });
    this._contextCreatedEvent = {
      version: VERSION,
      type: 'context-options',
      browserName: this._context._browser.options.name,
      options: this._context._options
    };
  }

  start(options: TracerOptions) {
    if (this._isStopping)
      throw new Error('Cannot start tracing while stopping');
    if (this._state) {
      const o = this._state.options;
      if (o.name !== options.name || !o.screenshots !== !options.screenshots || !o.snapshots !== !options.snapshots)
        throw new Error('Tracing has been already started with different options');
      return;
    }

    // TODO: passing the same name for two contexts makes them write into a single file
    // and conflict.
    const traceName = options.name || createGuid();
    const traceFile = path.join(this._tracesDir, traceName + '.trace');
    const networkFile = path.join(this._tracesDir, traceName + '.network');
    this._state = { options, traceName, traceFile, networkFile, filesCount: 0, sha1s: new Set(), recording: false };

    this._writeChain = fs.promises.mkdir(this._resourcesDir, { recursive: true }).then(() => fs.promises.writeFile(networkFile, ''));
    if (options.snapshots)
      this._harTracer.start();
  }

  async startChunk() {
    if (this._state && this._state.recording)
      await this.stopChunk(false);

    if (!this._state)
      throw new Error('Must start tracing before starting a new chunk');
    if (this._isStopping)
      throw new Error('Cannot start a trace chunk while stopping');

    const state = this._state;
    const suffix = state.filesCount ? `-${state.filesCount}` : ``;
    state.filesCount++;
    state.traceFile = path.join(this._tracesDir, `${state.traceName}${suffix}.trace`);
    state.recording = true;

    this._appendTraceOperation(async () => {
      await mkdirIfNeeded(state.traceFile);
      await fs.promises.appendFile(state.traceFile, JSON.stringify(this._contextCreatedEvent) + '\n');
    });

    this._context.instrumentation.addListener(this);
    if (state.options.screenshots)
      this._startScreencast();
    if (state.options.snapshots)
      await this._snapshotter.start();
  }

  private _startScreencast() {
    for (const page of this._context.pages())
      this._startScreencastInPage(page);
    this._screencastListeners.push(
        eventsHelper.addEventListener(this._context, BrowserContext.Events.Page, this._startScreencastInPage.bind(this)),
    );
  }

  private _stopScreencast() {
    eventsHelper.removeEventListeners(this._screencastListeners);
    for (const page of this._context.pages())
      page.setScreencastOptions(null);
  }

  async stop() {
    if (!this._state)
      return;
    if (this._isStopping)
      throw new Error(`Tracing is already stopping`);
    if (this._state.recording)
      throw new Error(`Must stop trace file before stopping tracing`);
    this._harTracer.stop();
    await this._writeChain;
    this._state = undefined;
  }

  async dispose() {
    this._snapshotter.dispose();
    await this._writeChain;
  }

  async stopChunk(save: boolean): Promise<Artifact | null> {
    if (this._isStopping)
      throw new Error(`Tracing is already stopping`);
    this._isStopping = true;

    for (const { sdkObject, metadata, beforeSnapshot, actionSnapshot, afterSnapshot } of this._pendingCalls.values()) {
      await Promise.all([beforeSnapshot, actionSnapshot, afterSnapshot]);
      let callMetadata = metadata;
      if (!afterSnapshot) {
        // Note: we should not modify metadata here to avoid side-effects in any other place.
        callMetadata = {
          ...metadata,
          error: { error: { name: 'Error', message: 'Action was interrupted' } },
        };
      }
      await this.onAfterCall(sdkObject, callMetadata);
    }

    if (!this._state || !this._state.recording) {
      this._isStopping = false;
      if (save)
        throw new Error(`Must start tracing before stopping`);
      return null;
    }

    const state = this._state!;
    this._context.instrumentation.removeListener(this);
    if (state.options.screenshots)
      this._stopScreencast();
    if (state.options.snapshots)
      await this._snapshotter.stop();

    // Chain the export operation against write operations,
    // so that neither trace files nor sha1s change during the export.
    return await this._appendTraceOperation(async () => {
      const result = save ? this._export(state) : Promise.resolve(null);
      return result.finally(async () => {
        this._isStopping = false;
        state.recording = false;
      });
    });
  }

  private async _export(state: RecordingState): Promise<Artifact> {
    const zipFile = new yazl.ZipFile();
    const failedPromise = new Promise<Artifact>((_, reject) => (zipFile as any as EventEmitter).on('error', reject));
    const succeededPromise = new Promise<Artifact>(fulfill => {
      zipFile.addFile(state.traceFile, 'trace.trace');
      zipFile.addFile(state.networkFile, 'trace.network');
      const zipFileName = state.traceFile + '.zip';
      for (const sha1 of state.sha1s)
        zipFile.addFile(path.join(this._resourcesDir, sha1), path.join('resources', sha1));
      zipFile.end();
      zipFile.outputStream.pipe(fs.createWriteStream(zipFileName)).on('close', () => {
        const artifact = new Artifact(this._context, zipFileName);
        artifact.reportFinished();
        fulfill(artifact);
      });
    });
    return Promise.race([failedPromise, succeededPromise]);
  }

  async _captureSnapshot(name: 'before' | 'after' | 'action' | 'event', sdkObject: SdkObject, metadata: CallMetadata, element?: ElementHandle) {
    if (!sdkObject.attribution.page)
      return;
    if (!this._snapshotter.started())
      return;
    if (!shouldCaptureSnapshot(metadata))
      return;
    const snapshotName = `${name}@${metadata.id}`;
    metadata.snapshots.push({ title: name, snapshotName });
    // We have |element| for input actions (page.click and handle.click)
    // and |sdkObject| element for accessors like handle.textContent.
    if (!element && sdkObject instanceof ElementHandle)
      element = sdkObject;
    await this._snapshotter.captureSnapshot(sdkObject.attribution.page, snapshotName, element).catch(() => {});
  }

  async onBeforeCall(sdkObject: SdkObject, metadata: CallMetadata) {
    // Set afterSnapshot name for all the actions that operate selectors.
    // Elements resolved from selectors will be marked on the snapshot.
    metadata.afterSnapshot = `after@${metadata.id}`;
    const beforeSnapshot = this._captureSnapshot('before', sdkObject, metadata);
    this._pendingCalls.set(metadata.id, { sdkObject, metadata, beforeSnapshot });
    await beforeSnapshot;
  }

  async onBeforeInputAction(sdkObject: SdkObject, metadata: CallMetadata, element: ElementHandle) {
    const actionSnapshot = this._captureSnapshot('action', sdkObject, metadata, element);
    this._pendingCalls.get(metadata.id)!.actionSnapshot = actionSnapshot;
    await actionSnapshot;
  }

  async onAfterCall(sdkObject: SdkObject, metadata: CallMetadata) {
    const pendingCall = this._pendingCalls.get(metadata.id);
    if (!pendingCall || pendingCall.afterSnapshot)
      return;
    if (!sdkObject.attribution.context) {
      this._pendingCalls.delete(metadata.id);
      return;
    }
    pendingCall.afterSnapshot = this._captureSnapshot('after', sdkObject, metadata);
    await pendingCall.afterSnapshot;
    const event: trace.ActionTraceEvent = { type: 'action', metadata };
    this._appendTraceEvent(event);
    this._pendingCalls.delete(metadata.id);
  }

  onEvent(sdkObject: SdkObject, metadata: CallMetadata) {
    if (!sdkObject.attribution.context)
      return;
    const event: trace.ActionTraceEvent = { type: 'event', metadata };
    this._appendTraceEvent(event);
  }

  onEntryStarted(entry: har.Entry) {
  }

  onEntryFinished(entry: har.Entry) {
    const event: trace.ResourceSnapshotTraceEvent = { type: 'resource-snapshot', snapshot: entry };
    this._appendTraceOperation(async () => {
      visitSha1s(event, this._state!.sha1s);
      await fs.promises.appendFile(this._state!.networkFile, JSON.stringify(event) + '\n');
    });
  }

  onContentBlob(sha1: string, buffer: Buffer) {
    this._appendResource(sha1, buffer);
  }

  onSnapshotterBlob(blob: SnapshotterBlob): void {
    this._appendResource(blob.sha1, blob.buffer);
  }

  onFrameSnapshot(snapshot: FrameSnapshot): void {
    this._appendTraceEvent({ type: 'frame-snapshot', snapshot });
  }

  private _startScreencastInPage(page: Page) {
    page.setScreencastOptions(kScreencastOptions);
    const prefix = page.guid;
    let frameSeq = 0;
    this._screencastListeners.push(
        eventsHelper.addEventListener(page, Page.Events.ScreencastFrame, params => {
          const suffix = String(++frameSeq).padStart(10, '0');
          const sha1 = `${prefix}-${suffix}.jpeg`;
          const event: trace.ScreencastFrameTraceEvent = {
            type: 'screencast-frame',
            pageId: page.guid,
            sha1,
            width: params.width,
            height: params.height,
            timestamp: monotonicTime()
          };
          // Make sure to write the screencast frame before adding a reference to it.
          this._appendResource(sha1, params.buffer);
          this._appendTraceEvent(event);
        }),
    );
  }

  private _appendTraceEvent(event: trace.TraceEvent) {
    this._appendTraceOperation(async () => {
      visitSha1s(event, this._state!.sha1s);
      await fs.promises.appendFile(this._state!.traceFile, JSON.stringify(event) + '\n');
    });
  }

  private _appendResource(sha1: string, buffer: Buffer) {
    if (this._allResources.has(sha1))
      return;
    this._allResources.add(sha1);
    this._appendTraceOperation(async () => {
      const resourcePath = path.join(this._resourcesDir, sha1);
      try {
        // Perhaps we've already written this resource?
        await fs.promises.access(resourcePath);
      } catch (e) {
        // If not, let's write! Note that async access is safe because we
        // never remove resources until the very end.
        await fs.promises.writeFile(resourcePath, buffer).catch(() => {});
      }
    });
  }

  private async _appendTraceOperation<T>(cb: () => Promise<T>): Promise<T> {
    // This method serializes all writes to the trace.
    let error: Error | undefined;
    let result: T | undefined;
    this._writeChain = this._writeChain.then(async () => {
      try {
        result = await cb();
      } catch (e) {
        error = e;
      }
    });
    await this._writeChain;
    if (error)
      throw error;
    return result!;
  }
}

function visitSha1s(object: any, sha1s: Set<string>) {
  if (Array.isArray(object)) {
    object.forEach(o => visitSha1s(o, sha1s));
    return;
  }
  if (typeof object === 'object') {
    for (const key in object) {
      if (key === 'sha1' || key === '_sha1' || key.endsWith('Sha1')) {
        const sha1 = object[key];
        if (sha1)
          sha1s.add(sha1);
      }
      visitSha1s(object[key], sha1s);
    }
    return;
  }
}

export function shouldCaptureSnapshot(metadata: CallMetadata): boolean {
  return commandsWithTracingSnapshots.has(metadata.type + '.' + metadata.method);
}
