/**
 * Copyright 2018 Google Inc. All rights reserved.
 * Modifications copyright (c) Microsoft Corporation.
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

import type { ConnectionTransport, ProtocolRequest, ProtocolResponse } from './transport';
import { makeWaitForNextTask } from '../utils';
import { debugLogger } from '../common/debugLogger';
import { cbor } from '../utilsBundle';
import { encode } from 'packages/playwright-core/bundles/utils/node_modules/cbor/types/lib/encoder';

export class PipeTransport implements ConnectionTransport {
  private _pipeWrite: NodeJS.WritableStream;
  private _pendingMessage = '';
  private _waitForNextTask = makeWaitForNextTask();
  private _closed = false;
  private _transportMode: 'cbor' | 'json';

  onmessage?: (message: ProtocolResponse) => void;
  onclose?: () => void;
  private _decoder: any;

  constructor(pipeWrite: NodeJS.WritableStream, pipeRead: NodeJS.ReadableStream, transportMode: 'cbor' | 'json') {
    this._pipeWrite = pipeWrite;
    this._transportMode = transportMode;

    this._decoder = new cbor.Decoder();
    this._decoder.on('data', (obj: any) => {
      console.log(obj)
    });
    if (transportMode === 'json')
      pipeRead.on('data', buffer => this._dispatchJSON(buffer));
    else
      pipeRead.on('data', buffer => this._dispatchCBOR(buffer));
    pipeRead.on('close', () => {
      this._closed = true;
      if (this.onclose)
        this.onclose.call(null);
    });
    pipeRead.on('error', e => debugLogger.log('error', e));
    pipeWrite.on('error', e => debugLogger.log('error', e));
    this.onmessage = undefined;
    this.onclose = undefined;
  }

  send(message: ProtocolRequest) {
    if (this._closed)
      throw new Error('Pipe has been closed');
    if (this._transportMode === 'json') {
      this._pipeWrite.write(JSON.stringify(message));
      this._pipeWrite.write('\0');
    } else {
      this._pipeWrite.write(yoshaSerialize(message));
    }
  }

  close() {
    throw new Error('unimplemented');
  }

  _dispatchJSON(buffer: Buffer) {
    let end = buffer.indexOf('\0');
    if (end === -1) {
      this._pendingMessage += buffer.toString();
      return;
    }
    const message = this._pendingMessage + buffer.toString(undefined, 0, end);
    this._waitForNextTask(() => {
      if (this.onmessage)
        this.onmessage.call(null, JSON.parse(message));
    });

    let start = end + 1;
    end = buffer.indexOf('\0', start);
    while (end !== -1) {
      const message = buffer.toString(undefined, start, end);
      this._waitForNextTask(() => {
        if (this.onmessage)
          this.onmessage.call(null, JSON.parse(message));
      });
      start = end + 1;
      end = buffer.indexOf('\0', start);
    }
    this._pendingMessage = buffer.toString(undefined, start);
  }

  _dispatchCBOR(buffer: Buffer) {
    console.log(buffer.toString());
    this._decoder.write(buffer);
  }
}

function yoshaSerialize(message: any, isNested = false) {
  const encoder = new cbor.Encoder();
  message.params = message.params || null;
  
  encoder._pushUInt8(0xd8); // envelope tag
  encoder._pushUInt8(0x5a); // expect 32-bit length
  encoder._pushUInt32BE(0); // save space for length

  encoder._pushUInt8((5 << 5) | 31); // indefinite map
  for (const key in message) {
    const value = message[key];
    encoder._pushString(key);
    if (!isNested && key === 'params' && value) {
      encoder.push(yoshaSerialize(value, true));
      continue;
    }
    if (value && typeof value === 'object')
      cbor.Encoder.encodeIndefinite(encoder, value);
    else {
      encoder.pushAny(value);
    }
  }
  encoder.push(Buffer.from([0xff])); // break

  const encoded = encoder._encodeAll([]);
  encoded.writeInt32BE(encoded.length - 6, 2);
  return encoded;
}
