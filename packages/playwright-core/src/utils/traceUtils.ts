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

import fs from 'fs';
import path from 'path';
import type EventEmitter from 'events';
import type { ClientSideCallMetadata } from '@protocol/channels';
import type { SerializedClientSideCallMetadata, SerializedStack, SerializedStackFrame } from '@trace/traceUtils';
import { yazl, yauzl } from '../zipBundle';
import { ManualPromise } from './manualPromise';

export function serializeClientSideCallMetadata(metadatas: ClientSideCallMetadata[]): SerializedClientSideCallMetadata {
  const fileNames = new Map<string, number>();
  const stacks: SerializedStack[] = [];
  for (const m of metadatas) {
    if (!m.stack || !m.stack.length)
      continue;
    const stack: SerializedStackFrame[] = [];
    for (const frame of m.stack) {
      let ordinal = fileNames.get(frame.file);
      if (typeof ordinal !== 'number') {
        ordinal = fileNames.size;
        fileNames.set(frame.file, ordinal);
      }
      const stackFrame: SerializedStackFrame = [ordinal, frame.line || 0, frame.column || 0, frame.function || ''];
      stack.push(stackFrame);
    }
    stacks.push([m.id, stack]);
  }
  return { files: [...fileNames.keys()], stacks };
}

export function mergeSerializedClientSideCallMetadata(metadatas: SerializedClientSideCallMetadata[]): SerializedClientSideCallMetadata {
  const fileNames = new Map<string, number>();
  const stacks: SerializedStack[] = [];
  for (const m of metadatas) {
    const ordinalMap = new Map<number, number>();
    for (let i = 0; i < m.files.length; ++i) {
      let ordinal = fileNames.get(m.files[i]);
      if (typeof ordinal !== 'number') {
        ordinal = fileNames.size;
        fileNames.set(m.files[i], ordinal);
      }
      ordinalMap.set(i, ordinal);
      for (const stack of m.stacks)
        stack[0] = ordinalMap.get(stack[0])!;
    }
  }
  return { files: [...fileNames.keys()], stacks };
}

export async function mergeTraceFiles(fileName: string, temporaryTraceFiles: string[]) {
  if (temporaryTraceFiles.length === 1) {
    await fs.promises.rename(temporaryTraceFiles[0], fileName);
    return;
  }

  const mergePromise = new ManualPromise();
  const zipFile = new yazl.ZipFile();
  (zipFile as any as EventEmitter).on('error', error => mergePromise.reject(error));

  for (let i = 0; i < temporaryTraceFiles.length; ++i) {
    const tempFile = temporaryTraceFiles[i];
    const promise = new ManualPromise<void>();
    yauzl.open(tempFile, (err, inZipFile) => {
      if (err) {
        promise.reject(err);
        return;
      }
      let pendingEntries = inZipFile.entryCount;
      inZipFile.on('entry', entry => {
        inZipFile.openReadStream(entry, (err, readStream) => {
          if (err) {
            promise.reject(err);
            return;
          }
          zipFile.addReadStream(readStream!, i + '-' + entry.fileName);
          if (--pendingEntries === 0)
            promise.resolve();
        });
      });
    });
    await promise;
  }

  zipFile.end(undefined, () => {
    zipFile.outputStream.pipe(fs.createWriteStream(fileName)).on('close', () => {
      Promise.all(temporaryTraceFiles.map(tempFile => fs.promises.unlink(tempFile))).then(() => {
        mergePromise.resolve();
      });
    });
  });
  await mergePromise;
}
