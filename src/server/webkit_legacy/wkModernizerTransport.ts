/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
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

import debug from 'debug';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import { makeWaitForNextTask } from '../../utils/utils';
import { ConnectionTransport, ProtocolRequest, ProtocolResponse } from '../transport';

let lastArtificialRequestId = 1000000000;

export class WKModernizerTransport implements ConnectionTransport {
  private _waitForNextTask = makeWaitForNextTask();
  private _httpEndpoint: string;

  onmessage?: (message: ProtocolResponse) => void;
  onclose?: () => void;
  private _connections = new Map<string, PageConnection>();
  private _playwrightNavigateIds = new Set<number>();
  private _pageNavigateIds = new Map<number, number>();

  static async connect(httpEndpoint: string): Promise<WKModernizerTransport> {
    return new WKModernizerTransport(httpEndpoint);
  }

  constructor(httpEndpoint: string) {
    this._httpEndpoint = httpEndpoint;
  }

  send(request: ProtocolRequest): void {
    this._dispatchRequest(request)
  }

  private async _dispatchRequest(request: ProtocolRequest & { pageProxyId?: string }) {
    debug('pw:ios:modernizer:send')(request);
    const { id, method, params, pageProxyId } = request;
    switch (method) {
      case 'Playwright.enable': {
        const response = await fetch(`${this._httpEndpoint}/json/list`);
        let list = await response.json() as { webSocketDebuggerUrl: string, title: string }[];
        list = list.filter(item => item.title !== 'ServiceWorker');

        // Connect to all pages over web sockets.
        const connections = await Promise.all(list.map(page => PageConnection.connect(page.webSocketDebuggerUrl)));
        for (const connection of connections) {
          // For each connection dispatch page created.
          this._dispatchEvent({
            method: 'Playwright.pageProxyCreated',
            params: { pageProxyId: connection.pageProxyId }
          });
          // And start dispatching messages w/ proxy id.
          connection.ws.on('message', data => {
            const message = JSON.parse(data.toString()) as ProtocolResponse;
            debug('pw:ios:socket:recv')(message);

            {
              // Cross-origin navigations dispatch pairs of Target.targetCreated / Target.targetDestroyed with
              // the same page id, ignore them.
              if (message.method === 'Target.targetCreated')
                return;
              if (message.method === 'Target.targetDestroyed')
                return;
            }

            {
              // We translate Playwright.navigate into Target.sendMessageToTarget(Page.navigate).
              // Hold Target.sendMessageToTarget ack until we get Target.dispatchMessageFromTarget(Page.navigate ack)
              if (this._playwrightNavigateIds.has(message.id!)) {
                // Hold it, this is just an ack.
                this._playwrightNavigateIds.delete(message.id!);
                return;
              }
              if (message.method === 'Target.dispatchMessageFromTarget') {
                const innerMessage = JSON.parse(message.params.message);
                const originalId = this._pageNavigateIds.get(innerMessage.id);
                if (originalId) {
                  // This is our Page.navigate ack, sell it as a Playwright.navigate ack.
                  this._pageNavigateIds.delete(innerMessage.id);
                  this._dispatchEvent({ id: originalId, result: {} });
                  return;
                }
              }
            }

            message.pageProxyId = connection.pageProxyId;
            this._dispatchEvent(message);
          });
          // And retain.
          this._connections.set(connection.pageProxyId, connection);
        }
        // Deliver ack for Playwright.enable
        this._sendResponse({ id });

        // Now each page dispatches targetCreated.
        for (const connection of connections) {
          this._dispatchEvent({
            method: 'Target.targetCreated',
            params: { targetInfo: connection.targetInfo },
            pageProxyId: connection.pageProxyId
          });
        }

        // We are done.
        break;
      }

      case 'Playwright.navigate': {
        const artificialRequestId = ++lastArtificialRequestId;
        this._playwrightNavigateIds.add(id);
        this._pageNavigateIds.set(artificialRequestId, id);
        const url = params.url;
        const replacement = {
          id,
          method: 'Target.sendMessageToTarget',
          params: {
            targetId: params.pageProxyId,
            message: JSON.stringify({ id: artificialRequestId, method: 'Page.navigate', params: { url } })
          }
        };
        const connection = this._connections.get(params.pageProxyId)!;
        debug('pw:ios:socket:send')(replacement);
        connection.ws.send(JSON.stringify(replacement));
        break;
      }

      case 'Dialog.enable': {
        this._sendResponse({ id, pageProxyId });
        break;
      }

      case 'Emulation.setActiveAndFocused': {
        this._sendResponse({ id, pageProxyId });
        break;
      }

      case 'Emulation.setAuthCredentials': {
        this._sendResponse({ id, pageProxyId });
        break;
      }

      case 'Target.sendMessageToTarget': {
        delete request.pageProxyId;
        const { method, id: innerId, params: innerParams } = JSON.parse(params.message) as ProtocolRequest;
        if (method === 'Page.createUserWorld' ||
            method === 'Page.setBootstrapScript' ||
            method === 'Page.setTouchEmulationEnabled') {
          const response = { id: innerId };
          this._sendResponse({ id, pageProxyId });
          this._dispatchEvent({ method: 'Target.dispatchMessageFromTarget', pageProxyId, params: { targetId: request.params.targetId, message: JSON.stringify(response) } });
          break;
        }
        if (method === 'Runtime.enable') {
          const event1 = {
            method: 'Runtime.executionContextCreated',
            params: { context: { id: 0, type: 'normal', name: 'default', frameId: 0 } }
          };
          this._dispatchEvent({ method: 'Target.dispatchMessageFromTarget', pageProxyId, params: { targetId: request.params.targetId, message: JSON.stringify(event1) } });
          const event2 = {
            method: 'Runtime.executionContextCreated',
            params: { context: { id: 1, type: 'user', name: 'default', frameId: 0 } }
          };
          this._dispatchEvent({ method: 'Target.dispatchMessageFromTarget', pageProxyId, params: { targetId: request.params.targetId, message: JSON.stringify(event2) } });
        }
        if (method === 'Runtime.evaluate') {
          delete innerParams.contextId;
          params.message = JSON.stringify({ method, id: innerId, params: innerParams });
        }
        debug('pw:ios:send')(request);
        const connection = this._connections.get(pageProxyId!)!;
        connection.ws.send(JSON.stringify(request));
        break;
      }

      default: {
        console.log(method);
        break;
      }
    }
  }

  private _sendResponse(response: ProtocolResponse) {
    this._waitForNextTask(() => {
      debug('pw:ios:modernizer:recv')(response);
      this.onmessage!(response)
    });
  }

  private _dispatchEvent(response: ProtocolResponse) {
    this._waitForNextTask(() => {
      debug('pw:ios:modernizer:recv')(response);
      this.onmessage!(response)
    });
  }

  close(): void {
  }

  async closeAndWait() {
  }
}

class PageConnection {
  readonly pageProxyId: string;
  readonly targetInfo: any;
  readonly ws: WebSocket;

  static connect(webSocketDebuggerUrl: string): Promise<PageConnection> {
    const ws = new WebSocket(webSocketDebuggerUrl, [], {
      perMessageDeflate: false,
      maxPayload: 256 * 1024 * 1024, // 256Mb,
      handshakeTimeout: 30000,
    });

    let callback: (connection: PageConnection) => void;
    const connectPromise = new Promise<PageConnection>(f => callback = f);
    ws.once('message', data => {
      const message = JSON.parse(data.toString()) as ProtocolResponse;
      if (message.method !== 'Target.targetCreated')
        return;
      debug('pw:ios:socket:recv')(message);
      callback(new PageConnection(ws, message.params.targetInfo));
    });
    return connectPromise;
  }

  constructor(ws: WebSocket, targetInfo: any) {
    this.ws = ws;
    this.targetInfo = targetInfo;
    this.pageProxyId = targetInfo.targetId;
  }
}
