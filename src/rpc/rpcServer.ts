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

import { PipeTransport } from '../server/pipeTransport';
import { helper } from '../helper';
import * as api from '../api';
import * as fs from 'fs';
import { Playwright } from '../server/playwright';
import { Loggers } from '../logger';
import { BrowserContextBase } from '../browserContext';
import { Page } from '../page';
import { Events } from '../events';

const playwright = new Playwright(__dirname, require('../../browsers.json')['browsers']);

const dispatchers = new Map<string, Dispatcher>();
const dispatcherSymbol = Symbol('dispatcher');

class Dispatcher {
  readonly guid: string;
  readonly type: string;
  readonly transport: PipeTransport;

  constructor(object: any, type: string, params: any, transport: PipeTransport, guid = type + '@' + helper.guid()) {
    this.type = type;
    this.guid = guid;
    this.transport = transport;
    dispatchers.set(this.guid, this);
    object[dispatcherSymbol] = this;
    this.transport.send({ method: 'created', type, guid: guid, params } as any);
  }

  _dispatchEvent(method: string, data: Dispatcher | any) {
    if (data instanceof Dispatcher)
      this.transport.send({ guid: this.guid, method, params: { guid: data.guid } } as any);
    else
      this.transport.send({ guid: this.guid, method, params: data } as any);
  }

  _notifyDisposed() {
    this.transport.send({ method: 'disposed', type: this.type, guid: this.guid } as any);
    dispatchers.delete(this.guid);
  }
}

class BrowserTypeDispatcher extends Dispatcher {
  private _browserType: api.BrowserType;

  static from(type: api.BrowserType, transport: PipeTransport): BrowserTypeDispatcher {
    if ((type as any)[dispatcherSymbol])
      return (type as any)[dispatcherSymbol];
    return new BrowserTypeDispatcher(type, transport);
  }

  constructor(browserType: api.BrowserType, transport: PipeTransport) {
    super(browserType, 'browserType', {}, transport, browserType.name());
    this._browserType = browserType;
  }

  async launch(params: any) {
    const browser = await this._browserType.launch(params.options || undefined);
    return BrowserDispatcher.from(browser, this.transport);
  }
}

class BrowserDispatcher extends Dispatcher {
  private _browser: api.Browser;

  static from(browser: api.Browser, transport: PipeTransport): BrowserDispatcher {
    if ((browser as any)[dispatcherSymbol])
      return (browser as any)[dispatcherSymbol];
    return new BrowserDispatcher(browser, transport);
  }

  constructor(browser: api.Browser, transport: PipeTransport) {
    super(browser, 'browser', {}, transport);
    this._browser = browser;
  }

  async newContext(params: any) {
    return BrowserContextDispatcher.from(await this._browser.newContext(params.options || undefined) as BrowserContextBase, this.transport);
  }

  async newPage(params: any) {
    return PageDispatcher.from(await this._browser.newPage(params.options || undefined), this.transport);
  }

  async close() {
    await this._browser.close();
  }
}

class BrowserContextDispatcher extends Dispatcher {
  private _context: BrowserContextBase;

  static from(context: BrowserContextBase, transport: PipeTransport): BrowserContextDispatcher {
    if ((context as any)[dispatcherSymbol])
      return (context as any)[dispatcherSymbol];
    return new BrowserContextDispatcher(context, transport);
  }

  constructor(context: BrowserContextBase, transport: PipeTransport) {
    super(context, 'context', { browserGuid: BrowserDispatcher.from(context._browserBase, transport).guid }, transport);
    this._context = context;
    context.on(Events.BrowserContext.Page, (page: api.Page) => {
      this._dispatchEvent('page', PageDispatcher.from(page, transport));
    });
    context.on(Events.BrowserContext.Close, (page: api.Page) => {
      this._dispatchEvent('close', {});
      this._notifyDisposed();
    });
  }

  async close() {
    await this._context.close();
  }

  async newPage() {
    return PageDispatcher.from(await this._context.newPage(), this.transport);
  }
}

class PageDispatcher extends Dispatcher {
  private _page: Page;

  static from(page: Page, transport: PipeTransport): PageDispatcher {
    if ((page as any)[dispatcherSymbol])
      return (page as any)[dispatcherSymbol];
    return new PageDispatcher(page, transport);
  }

  constructor(page: Page, transport: PipeTransport) {
    super(page, 'page', { contextGuid: BrowserContextDispatcher.from(page._browserContext, transport).guid }, transport);
    this._page = page;
    page.on(Events.Page.Close, () => {
      this._dispatchEvent('close', {});
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
      return new ElementandleDispatcher(elementHandle, this.transport);
    return null;
  }

  async screenshot(params: any) {
    return (await this._page.screenshot(params.options || undefined)).toString('base64');
  }

  async title() {
    return await this._page.title();
  }
}

class ElementandleDispatcher extends Dispatcher {
  private _elementHandle: api.ElementHandle;

  constructor(elementHandle: api.ElementHandle, transport: PipeTransport) {
    super(elementHandle, 'elementHandle', { pageGuid: PageDispatcher.from(elementHandle._page, transport).guid }, transport);
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
  const pipeTransport = new PipeTransport(writeStream, readStream, new Loggers(undefined).protocol);

  BrowserTypeDispatcher.from(playwright.chromium!, pipeTransport);
  BrowserTypeDispatcher.from(playwright.firefox!, pipeTransport);
  BrowserTypeDispatcher.from(playwright.webkit!, pipeTransport);

  pipeTransport.onmessage = async (message: any) => {
    try {
      const { guid, method, params } = message;
      const dispatcher = dispatchers.get(guid);
      const methodName = method.split('.')[1];
      const result = await (dispatcher as any)[methodName](params);
      if (result instanceof Dispatcher) {
        pipeTransport.send({ id: message.id, result: { guid: result.guid } } as any);
        return;
      }
      pipeTransport.send({ id: message.id, result } as any);
    } catch (e) {
      pipeTransport.send({ error: e.stack } as any);
    }
  };
}
