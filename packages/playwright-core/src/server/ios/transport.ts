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

import { EventEmitter } from 'events';

import { debug, ws } from '../../utilsBundle';

import type { WebSocket } from '../../utilsBundle';

type Device = {
  deviceId: string;
  deviceName: string;
  deviceOSVersion: string;
  url: string;
};

type Page = {
  appId: string;
  url: string;
  title: string;
  webSocketDebuggerUrl: string;
};

type ProtocolResponse = {
  id: number;
  result: any;
  error?: string;
};

type ProtocolEvent = {
  method: string;
  params: any;
};

class RootTransport extends EventEmitter {
  private _ws: WebSocket | undefined;
  private _id = 0;
  private _callbacks = new Map<number, { fulfill: (value: any) => void, reject: (error: Error) => void }>();

  async connect() {
    const driver = await this._findDriverPage();
    if (!driver)
      throw new Error('No iOS driver found');

    this._ws = new ws(driver.page.webSocketDebuggerUrl);
    this._ws.onmessage = event => {
      const message = JSON.parse(String(event.data)) as ProtocolResponse | ProtocolEvent;
      if ('id' in message) {
        const callback = this._callbacks.get(message.id);
        if (!callback)
          throw new Error(`Protocol error: No callback found for id ${message.id}`);
        if (message.error)
          callback.reject(new Error(message.error));
        else
          callback.fulfill(message.result);
      } else {
        this.emit(message.method, message.params);
      }
    };

    return new Promise<void>((fulfill, reject) => {
      this._ws!.addEventListener('open', () => {
        fulfill();
      });
      this._ws!.addEventListener('error', event => {
        reject(new Error(`WebSocket error: ${event}`));
      });
    });
  }

  private async _findDriverPage(): Promise<{ device: Device, page: Page } | undefined> {
    const devicesResponse = await fetch('http://localhost:9221/json');
    const devices = await devicesResponse.json() as Device[];
    for (const device of devices) {
      const pagesResponse = await fetch(`http://${device.url}/json`);
      const pages = await pagesResponse.json() as Page[];
      for (const page of pages) {
        if (page.title === 'iOS Driver')
          return { device, page };
      }
    }
  }

  async send(method: string, params: any): Promise<ProtocolResponse> {
    return new Promise<ProtocolResponse>((fulfill, reject) => {
      this._ws!.send(JSON.stringify({
        id: ++this._id,
        method,
        params,
      }));
      this._callbacks.set(this._id, { fulfill, reject });
    });
  }
}

export class DriverTransport extends EventEmitter {
  private _root: RootTransport | undefined;
  private _targetId: string | undefined;
  private _windowObjectId: string | undefined;
  private _id = 0;
  private _callbacks = new Map<number, { fulfill: (value: ProtocolResponse) => void, reject: (error: Error) => void }>();

  async connect() {
    await new Promise<void>(async resolve => {
      this._root = new RootTransport();
      this._root.on('Target.targetCreated', params => {
        debug('pw:ios:page')(`Target created: ${params.targetInfo.targetId}`);
        this._targetId = params.targetInfo.targetId;
        resolve();
      });
      this._root.on('Target.dispatchMessageFromTarget', params => {
        const innerMessage = JSON.parse(params.message);
        if (innerMessage.id !== undefined) {
          const callback = this._callbacks.get(innerMessage.id);
          if (!callback)
            throw new Error(`Protocol error: No callback found for id ${innerMessage.id}`);
          if (innerMessage.error)
            callback.reject(new Error(innerMessage.error.message));
          else
            callback.fulfill(innerMessage.result);
        } else {
          this.emit(innerMessage.method, innerMessage.params);
        }
      });
      await this._root.connect();
    });
    const response = await this._send('Runtime.evaluate', { expression: 'globalThis' });
    this._windowObjectId = response.result.objectId;
    await this._navigateIfNeeded();
  }

  private async _navigateIfNeeded() {
    debug('pw:ios:page')('Navigating if needed');
    const url = await this.evaluate(() => location.href);
    if (url !== 'about:blank') {
      debug('pw:ios:page')(`Already navigated to ${url}`);
      return;
    }
    await this.evaluate(() => {
      location.href = 'http://localhost:22087';
    });
    for (let i = 0; i < 5; i++) {
      await new Promise(f => setTimeout(f, 1000));
      const url = await this.evaluate(() => location.href);
      if (url !== 'about:blank') {
        debug('pw:ios:page')(`Navigated to ${url}`);
        return;
      }
    }
  }

  async fetch(path: string, queryParams: Record<string, any> = {}, body: any = undefined) {
    const url = new URL(path, `http://localhost`);
    for (const [key, value] of Object.entries(queryParams))
      url.searchParams.append(key, String(value));
    const uri = url.toString().substring('http://localhost'.length);
    if (body)
      debug('pw:ios:transport')(`Fetching ${uri} with body: ${JSON.stringify(body)}`);
    else
      debug('pw:ios:transport')(`Fetching ${uri}`);

    const jsonText = await this.evaluate((uri: string, body: any) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', uri, false);
      xhr.send(body ? JSON.stringify(body) : undefined);
      return xhr.responseText;
    }, [uri, body]);
    return JSON.parse(jsonText);
  }

  async evaluate(functionDeclaration: Function, args: string[] = []): Promise<any> {
    const response = await this._send('Runtime.callFunctionOn', {
      functionDeclaration: String(functionDeclaration),
      objectId: this._windowObjectId,
      arguments: args.map(arg => ({ value: arg })),
      emulateUserGesture: true,
      includeCommandLineAPI: true,
    });
    if (response.wasThrown)
      throw new Error(response.result.description);
    return response.result.value;
  }

  async callFunctionOn(functionDeclaration: Function, args: string[] = []): Promise<any> {
    let response = await this._send('Runtime.callFunctionOn', {
      functionDeclaration: String(functionDeclaration),
      objectId: this._windowObjectId,
      arguments: args.map(arg => ({ value: arg })),
      emulateUserGesture: true,
      includeCommandLineAPI: true,
    });
    if (response.result?.type === 'object' && response.result.className === 'Promise') {
      response = await this._send('Runtime.awaitPromise', {
        promiseObjectId: response.result.objectId,
      });
    }
    if (response.wasThrown)
      throw new Error(response.result.description);
    return response.result.value;
  }

  private async _send(method: string, params: any): Promise<any> {
    return new Promise<ProtocolResponse>((fulfill, reject) => {
      const message = JSON.stringify({
        id: ++this._id,
        method,
        params,
      });
      this._root!.send('Target.sendMessageToTarget', {
        targetId: this._targetId,
        message,
      });
      this._callbacks.set(this._id, { fulfill, reject });
    });
  }
}
