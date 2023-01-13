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

import http from 'http';
import { DispatcherConnection, RootDispatcher } from 'playwright-core/lib/server';
import { WebSocketServer, wsServer } from 'playwright-core/lib/utilsBundle';
import { TestController } from './testController';

type ServerOptions = {
  path: string;
};

export class TestServer {
  private _wsServer: WebSocketServer | undefined;
  private _options: ServerOptions;

  constructor(options: ServerOptions) {
    this._options = options;
  }

  async start(port: number = 0) {
    const server = http.createServer((request: http.IncomingMessage, response: http.ServerResponse) => {
      if (request.method === 'GET' && request.url === '/json') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          wsEndpointPath: this._options.path,
        }));
        return;
      }
      response.end('Running');
    });
    server.on('error', error => console.error(error));

    const wsEndpoint = await new Promise<string>((resolve, reject) => {
      server.listen(port, () => {
        const address = server.address();
        if (!address) {
          reject(new Error('Could not bind server socket'));
          return;
        }
        const wsEndpoint = typeof address === 'string' ? `${address}${this._options.path}` : `ws://127.0.0.1:${address.port}${this._options.path}`;
        resolve(wsEndpoint);
      }).on('error', reject);
    });

    console.log('Listening at ' + wsEndpoint);

    this._wsServer = new wsServer({ server, path: this._options.path });
    this._wsServer.on('connection', (ws, request) => {
      const url = new URL('http://localhost' + (request.url || ''));
      const dispatcherConnection = new DispatcherConnection();
      dispatcherConnection.onmessage = async message => {
        if (ws.readyState !== ws.CLOSING)
          ws.send(JSON.stringify(message));
      };
      ws.on('message', async (message: string) => {
        dispatcherConnection.dispatch(JSON.parse(Buffer.from(message).toString()));
      });
  
      let testController: TestController | undefined;
      ws.on('close', () => testController?._dispose());
      ws.on('error', (error: Error) => testController?._dispose());
      testController = new TestController(dispatcherConnection);
    });

    await new Promise(() => {});
  }

  async stop() {
    const server = this._wsServer;
    if (!server)
      return;
    const waitForClose = new Promise(f => server.close(f));
    // First disconnect all remaining clients.
    await Promise.all(Array.from(server.clients).map(async ws => {
      try {
        ws.terminate();
      } catch (e) {
      }
    }));
    await waitForClose;
    await new Promise(f => server.options.server!.close(f));
    this._wsServer = undefined;
  }
}
