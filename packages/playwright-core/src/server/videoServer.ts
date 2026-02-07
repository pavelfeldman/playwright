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

import { eventsHelper } from '../utils';
import { HttpServer } from './utils/httpServer';
import { Page } from './page';
import { ProgressController } from './progress';
import { wsServer } from '../utilsBundle';

import type { RegisteredListener } from '../utils';
import type { WebSocket, WebSocketServer } from '../utilsBundle';
import type http from 'http';

const clientHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Playwright Screencast</title>
  <style>
    body {
      margin: 0; background: #111; color: #eee;
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      min-height: 100vh; font-family: system-ui, sans-serif;
    }
    h1 { font-size: 1.2rem; margin-bottom: 0.5rem; }
    #status { font-size: 0.85rem; color: #888; margin-bottom: 0.5rem; }
    #navbar {
      display: flex; align-items: center; gap: 6px;
      width: 80vw; max-width: 800px; margin-bottom: 1rem;
    }
    #navbar button {
      background: #222; color: #eee; border: 1px solid #444;
      border-radius: 4px; padding: 6px 10px; font-size: 1rem;
      cursor: pointer; line-height: 1;
    }
    #navbar button:hover { background: #333; }
    #urlbar {
      flex: 1; padding: 8px 12px;
      font-size: 0.95rem; font-family: system-ui, sans-serif;
      background: #222; color: #eee; border: 1px solid #444;
      border-radius: 4px; outline: none;
    }
    #urlbar:focus { border-color: #888; }
    #screen { position: relative; outline: none; }
    #screen.captured { cursor: crosshair; outline: 2px solid #4af; }
    #display {
      display: block; width: 80vw; aspect-ratio: 16 / 9;
      background: #000; border: 1px solid #333;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <h1>Playwright Screencast</h1>
  <div id="status">Connecting...</div>
  <div id="navbar">
    <button id="back" title="Back">&larr;</button>
    <button id="fwd" title="Forward">&rarr;</button>
    <input id="urlbar" type="text" placeholder="Enter URL..." spellcheck="false">
  </div>
  <div id="screen" tabindex="0">
    <img id="display" alt="screencast">
  </div>
  <script>
    const status = document.getElementById('status');
    const display = document.getElementById('display');
    const urlbar = document.getElementById('urlbar');
    const screenEl = document.getElementById('screen');

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(wsProtocol + '//' + location.host + '/ws');

    ws.onopen = () => { status.textContent = 'Connected'; };
    let viewportWidth = 0;
    let viewportHeight = 0;

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'frame') {
        display.src = 'data:image/jpeg;base64,' + msg.data;
        if (msg.viewportWidth) viewportWidth = msg.viewportWidth;
        if (msg.viewportHeight) viewportHeight = msg.viewportHeight;
      }
      if (msg.type === 'url' && document.activeElement !== urlbar)
        urlbar.value = msg.url;
    };
    ws.onclose = () => { status.textContent = 'Disconnected'; };
    ws.onerror = () => { status.textContent = 'WebSocket error'; };

    // Navigation
    urlbar.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        let url = urlbar.value;
        if (!/^https?:\\/\\//i.test(url)) url = 'https://' + url;
        urlbar.value = url;
        ws.send(JSON.stringify({ type: 'navigate', url }));
        urlbar.blur();
      }
    });
    document.getElementById('back').addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'back' }));
    });
    document.getElementById('fwd').addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'forward' }));
    });

    // Input capture
    const BUTTONS = ['left', 'middle', 'right'];
    let captured = false;

    function setCapture(on) {
      captured = on;
      screenEl.classList.toggle('captured', on);
      status.textContent = on ? 'Input captured (Esc to release)' : 'Connected';
    }

    function imgCoords(e) {
      if (!viewportWidth || !viewportHeight) return { x: 0, y: 0 };
      const rect = display.getBoundingClientRect();
      // Account for object-fit: contain — the rendered image may not fill the element.
      const imgAspect = display.naturalWidth / display.naturalHeight;
      const elemAspect = rect.width / rect.height;
      let renderW, renderH, offsetX, offsetY;
      if (imgAspect > elemAspect) {
        renderW = rect.width;
        renderH = rect.width / imgAspect;
        offsetX = 0;
        offsetY = (rect.height - renderH) / 2;
      } else {
        renderH = rect.height;
        renderW = rect.height * imgAspect;
        offsetX = (rect.width - renderW) / 2;
        offsetY = 0;
      }
      // Map to fractional position on the rendered image, then to viewport CSS coordinates.
      const fracX = (e.clientX - rect.left - offsetX) / renderW;
      const fracY = (e.clientY - rect.top - offsetY) / renderH;
      return {
        x: Math.round(fracX * viewportWidth),
        y: Math.round(fracY * viewportHeight),
      };
    }

    screenEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      screenEl.focus();
      if (!captured) { setCapture(true); return; }
      const { x, y } = imgCoords(e);
      ws.send(JSON.stringify({ type: 'mousedown', x, y, button: BUTTONS[e.button] || 'left' }));
    });

    screenEl.addEventListener('mouseup', (e) => {
      if (!captured) return;
      e.preventDefault();
      const { x, y } = imgCoords(e);
      ws.send(JSON.stringify({ type: 'mouseup', x, y, button: BUTTONS[e.button] || 'left' }));
    });

    let moveThrottle = 0;
    screenEl.addEventListener('mousemove', (e) => {
      if (!captured) return;
      const now = Date.now();
      if (now - moveThrottle < 32) return;
      moveThrottle = now;
      const { x, y } = imgCoords(e);
      ws.send(JSON.stringify({ type: 'mousemove', x, y }));
    });

    screenEl.addEventListener('wheel', (e) => {
      if (!captured) return;
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'wheel', deltaX: e.deltaX, deltaY: e.deltaY }));
    }, { passive: false });

    screenEl.addEventListener('contextmenu', (e) => e.preventDefault());

    screenEl.addEventListener('keydown', (e) => {
      if (!captured) return;
      e.preventDefault();
      if (e.key === 'Escape') { setCapture(false); return; }
      ws.send(JSON.stringify({ type: 'keydown', key: e.key }));
    });

    screenEl.addEventListener('keyup', (e) => {
      if (!captured) return;
      e.preventDefault();
      ws.send(JSON.stringify({ type: 'keyup', key: e.key }));
    });

    screenEl.addEventListener('blur', () => { if (captured) setCapture(false); });
  </script>
</body>
</html>`;

export class VideoServer {
  private _page: Page;
  private _httpServer: HttpServer;
  private _wsServer: WebSocketServer | undefined;
  private _lastFrameData: string | null = null;
  private _lastViewportSize: { width: number, height: number } | null = null;
  private _frameListener: RegisteredListener | undefined;
  private _navigationListener: RegisteredListener | undefined;

  constructor(page: Page) {
    this._page = page;
    this._httpServer = new HttpServer();
  }

  async start(): Promise<string> {
    this._httpServer.routePath('/', (request: http.IncomingMessage, response: http.ServerResponse) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(clientHTML);
      return true;
    });

    this._wsServer = new wsServer({ server: this._httpServer.server(), path: '/ws' });
    this._wsServer.on('connection', (ws: WebSocket) => {
      if (this._lastFrameData)
        ws.send(JSON.stringify({ type: 'frame', data: this._lastFrameData, viewportWidth: this._lastViewportSize?.width, viewportHeight: this._lastViewportSize?.height }));
      const url = this._page.mainFrame().url();
      if (url)
        ws.send(JSON.stringify({ type: 'url', url }));
      ws.on('message', (raw: Buffer) => {
        this._handleMessage(raw).catch(() => {});
      });
    });

    this._frameListener = eventsHelper.addEventListener(this._page, Page.Events.ScreencastFrame, frame => this._writeFrame(frame.buffer, frame.width, frame.height));
    this._navigationListener = eventsHelper.addEventListener(this._page, Page.Events.InternalFrameNavigatedToNewDocument, frame => {
      if (frame === this._page.mainFrame())
        this._broadcast({ type: 'url', url: frame.url() });
    });

    await this._httpServer.start();
    return this._httpServer.urlPrefix('human-readable');
  }

  private _writeFrame(frame: Buffer, viewportWidth: number, viewportHeight: number) {
    const data = frame.toString('base64');
    this._lastFrameData = data;
    this._lastViewportSize = { width: viewportWidth, height: viewportHeight };
    this._broadcast({ type: 'frame', data, viewportWidth, viewportHeight });
  }

  private _broadcast(msg: object) {
    if (!this._wsServer)
      return;
    const message = JSON.stringify(msg);
    for (const client of this._wsServer.clients) {
      if (client.readyState === client.OPEN)
        client.send(message);
    }
  }

  private async _handleMessage(raw: Buffer) {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'navigate' && msg.url)
      await ProgressController.runInternalTask(async progress => { await this._page.mainFrame().goto(progress, msg.url); });
    else if (msg.type === 'back')
      await ProgressController.runInternalTask(async progress => { await this._page.goBack(progress, {}); });
    else if (msg.type === 'forward')
      await ProgressController.runInternalTask(async progress => { await this._page.goForward(progress, {}); });
    else if (msg.type === 'mousemove')
      await ProgressController.runInternalTask(async progress => { await this._page.mouse.move(progress, msg.x, msg.y); });
    else if (msg.type === 'mousedown')
      await ProgressController.runInternalTask(async progress => { await this._page.mouse.move(progress, msg.x, msg.y); await this._page.mouse.down(progress, { button: msg.button || 'left' }); });
    else if (msg.type === 'mouseup')
      await ProgressController.runInternalTask(async progress => { await this._page.mouse.move(progress, msg.x, msg.y); await this._page.mouse.up(progress, { button: msg.button || 'left' }); });
    else if (msg.type === 'wheel')
      await ProgressController.runInternalTask(async progress => { await this._page.mouse.wheel(progress, msg.deltaX, msg.deltaY); });
    else if (msg.type === 'keydown')
      await ProgressController.runInternalTask(async progress => { await this._page.keyboard.down(progress, msg.key); });
    else if (msg.type === 'keyup')
      await ProgressController.runInternalTask(async progress => { await this._page.keyboard.up(progress, msg.key); });
  }

  async stop() {
    if (this._frameListener)
      eventsHelper.removeEventListeners([this._frameListener]);
    this._frameListener = undefined;
    if (this._navigationListener)
      eventsHelper.removeEventListeners([this._navigationListener]);
    this._navigationListener = undefined;
    if (this._wsServer) {
      for (const client of this._wsServer.clients)
        client.terminate();
      await new Promise<void>(f => this._wsServer!.close(() => f()));
      this._wsServer = undefined;
    }
    await this._httpServer.stop();
  }
}
