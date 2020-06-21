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

import * as fs from 'fs';
import * as api from '../api';
import { BrowserContextBase } from '../browserContext';
import { ElementHandle } from '../dom';
import { Events } from '../events';
import { Frame } from '../frames';
import { helper } from '../helper';
import { Loggers } from '../logger';
import { Page } from '../page';
import { PipeTransport } from '../server/pipeTransport';
import { Playwright } from '../server/playwright';
import { BrowserTypeBase } from '../server/browserType';

const playwright = new Playwright(__dirname, require('../../browsers.json')['browsers']);

const dispatchers = new Map<string, Dispatcher>();
const dispatcherSymbol = Symbol('dispatcher');
let transport: PipeTransport | undefined;

class Dispatcher {
  readonly guid: string;
  readonly type: string;

  constructor(object: any, type: string, guid = type + '@' + helper.guid()) {
    this.type = type;
    this.guid = guid;
    dispatchers.set(this.guid, this);
    object[dispatcherSymbol] = this;
    transport!.send({ guid: this.guid, method: '__create__', type } as any);
  }

  _initialize(params = {}) {
    transport!.send({ guid: this.guid, method: '__init__', params} as any);
  }

  _dispatchEvent(method: string, data: Dispatcher | any = {}) {
    if (data instanceof Dispatcher)
      transport!.send({ guid: this.guid, method, params: { guid: data.guid } } as any);
    else
      transport!.send({ guid: this.guid, method, params: data } as any);
  }

  _notifyDisposed() {
    transport!.send({ method: '__dispose__', type: this.type, guid: this.guid } as any);
    dispatchers.delete(this.guid);
  }
}

class BrowserTypeDispatcher extends Dispatcher {
  private _browserType: BrowserTypeBase;

  static from(type: BrowserTypeBase): BrowserTypeDispatcher {
    if ((type as any)[dispatcherSymbol])
      return (type as any)[dispatcherSymbol];
    return new BrowserTypeDispatcher(type);
  }

  constructor(browserType: BrowserTypeBase) {
    super(browserType, 'browserType', browserType.name());
    this._browserType = browserType;
  }

  async launch(params: any) {
    const browser = await this._browserType.launch(params.options || undefined);
    return BrowserDispatcher.from(browser);
  }
}

class BrowserDispatcher extends Dispatcher {
  private _browser: api.Browser;

  static from(browser: api.Browser): BrowserDispatcher {
    if ((browser as any)[dispatcherSymbol])
      return (browser as any)[dispatcherSymbol];
    return new BrowserDispatcher(browser);
  }

  constructor(browser: api.Browser) {
    super(browser, 'browser');
    this._initialize({});
    this._browser = browser;
  }

  async newContext(params: any) {
    return BrowserContextDispatcher.from(await this._browser.newContext(params.options || undefined) as BrowserContextBase);
  }

  async newPage(params: any) {
    return PageDispatcher.from(await this._browser.newPage(params.options || undefined));
  }

  async close() {
    await this._browser.close();
  }

  _onContextCreated(context: BrowserContextBase) {
    this._dispatchEvent('contextCreated', BrowserContextDispatcher.from(context));
  }

  _onContextClosed(context: BrowserContextBase) {
    this._dispatchEvent('contextClosed', BrowserContextDispatcher.from(context));
  }
}

class BrowserContextDispatcher extends Dispatcher {
  private _context: BrowserContextBase;

  static from(context: BrowserContextBase): BrowserContextDispatcher {
    if ((context as any)[dispatcherSymbol])
      return (context as any)[dispatcherSymbol];
    return new BrowserContextDispatcher(context);
  }

  constructor(context: BrowserContextBase) {
    const browserDispatcher = BrowserDispatcher.from(context._browserBase);
    super(context, 'context');
    this._initialize({ browserGuid: browserDispatcher.guid });
    this._context = context;
    browserDispatcher._onContextCreated(context);
    context.on(Events.BrowserContext.Page, (page: Page) => this._onPageCreated(page));
    context.on(Events.BrowserContext.Close, () => {
      browserDispatcher._onContextClosed(this._context);
      this._onContextClosed();
      this._notifyDisposed();
    });
  }

  async close() {
    await this._context.close();
  }

  async newPage() {
    return PageDispatcher.from(await this._context.newPage());
  }

  _onPageCreated(page: Page) {
    this._dispatchEvent('pageCreated', PageDispatcher.from(page));
  }

  _onPageClosed(page: Page) {
    this._dispatchEvent('pageClosed', PageDispatcher.from(page));
  }

  _onContextClosed() {
    this._dispatchEvent('close');
  }
}

class PageDispatcher extends Dispatcher {
  private _page: Page;

  static from(page: Page): PageDispatcher {
    if ((page as any)[dispatcherSymbol])
      return (page as any)[dispatcherSymbol];
    return new PageDispatcher(page);
  }

  constructor(page: Page) {
    const browserContextDispatcher = BrowserContextDispatcher.from(page._browserContext);
    super(page, 'page');
    this._initialize({
      contextGuid: browserContextDispatcher.guid,
      mainFrameGuid: FrameDispatcher.from(page.mainFrame()).guid,
      frameGuids: page.frames().map(f => FrameDispatcher.from(f).guid),
    });
    this._page = page;
    page.on(Events.Page.FrameAttached, (frame: Frame) => this._dispatchEvent('frameAttached', FrameDispatcher.from(frame)));
    page.on(Events.Page.FrameDetached, frame => this._dispatchEvent('frameDetached', FrameDispatcher.from(frame)));
    page.on(Events.Page.Close, () => {
      this._dispatchEvent('close');
      browserContextDispatcher._onPageClosed(page);
      this._notifyDisposed();
    });
  }

  async click(params: any) {
    await this._page.click(params.selector, params.options || undefined);
  }

  async close(params: any) {
    await this._page.close(params.options || undefined);
  }

  async goto(params: any) {
    await this._page.goto(params.url, params.options || undefined);
  }

  async querySelector(params: any) {
    const elementHandle = await this._page.$(params.selector);
    if (elementHandle)
      return ElementHandleDispatcher.from(elementHandle);
    return null;
  }

  async screenshot(params: any) {
    return (await this._page.screenshot(params.options || undefined)).toString('base64');
  }

  async title() {
    return await this._page.title();
  }
}

class FrameDispatcher extends Dispatcher {
  private _frame: Frame;

  static from(frame: Frame): FrameDispatcher {
    if ((frame as any)[dispatcherSymbol])
      return (frame as any)[dispatcherSymbol];
    return new FrameDispatcher(frame);
  }

  constructor(frame: Frame) {
    const parentFrame = frame.parentFrame();

    super(frame, 'frame');
    this._initialize({
      pageGuid: PageDispatcher.from(frame._page).guid,
      url: frame.url(),
      name: frame.name(),
      parentFrameGuid: parentFrame ? FrameDispatcher.from(parentFrame).guid : undefined,
      childFrameGuids: frame.childFrames().map(f => FrameDispatcher.from(f).guid),
      isDetached: frame.isDetached()
    });
    frame._page.on(Events.Page.FrameNavigated, (frame: Frame) => {
      if (frame === this._frame)
        this._dispatchEvent('frameNavigated', this._frame.url());
    });
    frame._page.on(Events.Page.FrameAttached, (frame: Frame) => {
      if (frame.parentFrame() === this._frame)
        this._dispatchEvent('frameAttached', FrameDispatcher.from(frame));
    });
    frame._page.on(Events.Page.FrameDetached, (frame: Frame) => {
      if (frame.parentFrame() === this._frame)
        this._dispatchEvent('frameDetached', FrameDispatcher.from(frame));
    });
    this._frame = frame;
  }

  _onFrameNavigated() {
  }
}

class ElementHandleDispatcher extends Dispatcher {
  private _elementHandle: ElementHandle;

  static from(handle: ElementHandle): ElementHandleDispatcher {
    if ((handle as any)[dispatcherSymbol])
      return (handle as any)[dispatcherSymbol];
    return new ElementHandleDispatcher(handle);
  }

  constructor(elementHandle: ElementHandle) {
    super(elementHandle, 'elementHandle');
    this._initialize({ frameGuid: FrameDispatcher.from(elementHandle._context.frame).guid });
    this._elementHandle = elementHandle;
  }

  async click(params: any) {
    await this._elementHandle.click(params.options || undefined);
  }

  async screenshot(params: any) {
    await this._elementHandle.screenshot(params.options || undefined);
  }

  async textContent() {
    return await this._elementHandle.textContent();
  }
}

export async function runRpcServer() {
  const readStream = fs.createReadStream('', { fd: 0 });
  const writeStream = fs.createWriteStream('', { fd: 1});
  transport = new PipeTransport(writeStream, readStream, new Loggers(undefined).protocol);

  BrowserTypeDispatcher.from(playwright.chromium!);
  BrowserTypeDispatcher.from(playwright.firefox!);
  BrowserTypeDispatcher.from(playwright.webkit!);

  transport.onmessage = async (message: any) => {
    try {
      const { guid, method, params } = message;
      const dispatcher = dispatchers.get(guid);
      const result = await (dispatcher as any)[method](params);
      if (result instanceof Dispatcher) {
        transport!.send({ id: message.id, result: { guid: result.guid } } as any);
        return;
      }
      transport!.send({ id: message.id, result } as any);
    } catch (e) {
      transport!.send({ error: e.stack } as any);
    }
  };
}
