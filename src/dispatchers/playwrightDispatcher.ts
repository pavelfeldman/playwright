/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License");
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

import net from 'net';
import * as channels from '../protocol/channels';
import { Playwright } from '../server/playwright';
import { AndroidDispatcher } from './androidDispatcher';
import { BrowserTypeDispatcher } from './browserTypeDispatcher';
import { Dispatcher, DispatcherScope } from './dispatcher';
import { ElectronDispatcher } from './electronDispatcher';
import { SelectorsDispatcher } from './selectorsDispatcher';
import * as types from '../server/types';
import { SocksConnection, SocksConnectionClient } from '../utils/socksProxy';
import { createGuid } from '../utils/utils';

export class PlaywrightDispatcher extends Dispatcher<Playwright, channels.PlaywrightInitializer> implements channels.PlaywrightChannel {
  private _socksProxy: SocksProxy | undefined;

  constructor(scope: DispatcherScope, playwright: Playwright, customSelectors?: channels.SelectorsChannel, preLaunchedBrowser?: channels.BrowserChannel) {
    const descriptors = require('../server/deviceDescriptors') as types.Devices;
    const deviceDescriptors = Object.entries(descriptors)
        .map(([name, descriptor]) => ({ name, descriptor }));
    super(scope, playwright, 'Playwright', {
      chromium: new BrowserTypeDispatcher(scope, playwright.chromium),
      firefox: new BrowserTypeDispatcher(scope, playwright.firefox),
      webkit: new BrowserTypeDispatcher(scope, playwright.webkit),
      android: new AndroidDispatcher(scope, playwright.android),
      electron: new ElectronDispatcher(scope, playwright.electron),
      deviceDescriptors,
      selectors: customSelectors || new SelectorsDispatcher(scope, playwright.selectors),
      preLaunchedBrowser,
    }, false);
  }

  enableTethering(port: number) {
    this._socksProxy = new SocksProxy(this);
    this._socksProxy.listen(port);
  }

  async setSocketLocalAddress(params: channels.PlaywrightSetSocketLocalAddressParams, metadata?: channels.Metadata): Promise<void> {
    this._socksProxy?.setSocketLocalAddress(params);
  }

  async sendSocketData(params: channels.PlaywrightSendSocketDataParams, metadata?: channels.Metadata): Promise<void> {
    this._socksProxy?.sendSocketData(params);
  }

  async sendSocketError(params: channels.PlaywrightSendSocketErrorParams, metadata?: channels.Metadata): Promise<void> {
    this._socksProxy?.sendSocketError(params);
  }

  async sendSocketEnd(params: channels.PlaywrightSendSocketEndParams, metadata?: channels.Metadata): Promise<void> {
    this._socksProxy?.sendSocketEnd(params);
  }
}

class SocksProxy implements SocksConnectionClient {
  private _server: net.Server;
  private _connections = new Map<string, SocksConnection>();
  private _dispatcher: PlaywrightDispatcher;

  constructor(dispatcher: PlaywrightDispatcher) {
    this._dispatcher = dispatcher;
    this._server = new net.Server((socket: net.Socket) => {
      const uid = createGuid();
      const connection = new SocksConnection(uid, socket, this);
      this._connections.set(uid, connection);
    });
  }

  listen(port: number) {
    this._server.listen(port);
  }

  onSocketRequested(uid: string, host: string, port: number): void {
    this._dispatcher._dispatchEvent('socketRequested', { uid, host, port });
  }

  onSocketData(uid: string, data: Buffer): void {
    this._dispatcher._dispatchEvent('socketData', { uid, data: data.toString('base64') });
  }

  onSocketClosed(uid: string): void {
    this._dispatcher._dispatchEvent('socketClosed', { uid });
  }

  setSocketLocalAddress(params: channels.PlaywrightSetSocketLocalAddressParams) {
    this._connections.get(params.uid)?.setLocalAddress(params.host, params.port);
  }

  sendSocketData(params: channels.PlaywrightSendSocketDataParams) {
    this._connections.get(params.uid)?.sendData(Buffer.from(params.data, 'base64'));
  }

  sendSocketEnd(params: channels.PlaywrightSendSocketEndParams) {
    this._connections.get(params.uid)?.sendEnd();
  }

  sendSocketError(params: channels.PlaywrightSendSocketErrorParams) {
    this._connections.get(params.uid)?.sendError(params.code);
  }
}
