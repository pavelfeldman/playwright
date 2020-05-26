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

import * as dns from 'dns';
import * as net from 'net';
import * as util from 'util';
import { ProtocolApi } from './server/socksProxy';

const dnsLookupAsync = util.promisify(dns.lookup);

export class Tethering {
  private _sockets = new Map<string, net.Socket>();

  constructor(tetherHandler: ProtocolApi) {
    tetherHandler.on('Tethering.socketRequested', async (params: { uid: string, host: string, port: number }) => {
      const { uid } = params;
      try {
        const { address } = await dnsLookupAsync(params.host);
        const socket = await this._createSocket(address, params.port);
        socket.on('error', error => tetherHandler.sendError(uid, ''));
        socket.on('data', data => tetherHandler.sendData(uid, data));
        socket.on('end', () => tetherHandler.sendEnd(uid));
        const localAddress = socket.localAddress;
        const localPort = socket.localPort;
        this._sockets.set(uid, socket);
        tetherHandler.setLocalAddress(uid, localAddress, localPort);
      } catch (error) {
        tetherHandler.sendError(uid, error.code);
      }
    });

    tetherHandler.on('Tethering.socketData', (params: { uid: string, data: Buffer }) => {
      const socket = this._sockets.get(params.uid);
      if (socket)
        socket.write(params.data);
    });

    tetherHandler.on('Tethering.socketClosed', (params: { uid: string }) => {
      const socket = this._sockets.get(params.uid);
      if (socket)
        socket.end();
      this._sockets.delete(params.uid);
    });
  }

  private async _createSocket(host: string, port: number): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      socket.on('connect', () => resolve(socket));
      socket.on('error', error => reject(error));
    });
  }
}
