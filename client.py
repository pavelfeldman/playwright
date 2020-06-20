# Copyright (c) Microsoft Corporation.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import asyncio
import json
import os
import subprocess
from pyee import EventEmitter
from typing import Awaitable, Callable, Dict, List, Union, Optional


class Connection(EventEmitter):
  def __init__(self, input: asyncio.StreamReader, output: asyncio.StreamWriter, loop: asyncio.AbstractEventLoop) -> None:
    super().__init__()
    self._input = input
    self._output = output
    self.loop = loop
    self._lastId = 0
    self._channels: Dict[int, Channel] = dict()
    self._callbacks: Dict[int, asyncio.Future] = dict()
    self.loop.create_task(self._run())

  async def _run(self) -> None:
    while True:
      try:
        resp = await self._input.readuntil(b'\0')
        await self._on_message(resp[:-1])
      except:
        break
      await asyncio.sleep(0)

  def send(self, domain: str, method: str, guid: str, params: dict = None) -> Awaitable:
    if params is None:
      params = dict()
    self._lastId += 1
    id = self._lastId
    msg = json.dumps(dict(id=id, method='%s.%s' % (domain, method), params=params, guid=guid))
    self._output.write(bytes(msg, 'utf-8'))
    self._output.write(b'\0')
    # print('SEND> %s' % msg)
    callback = self.loop.create_future()
    self._callbacks[id] = callback
    return callback

  def lookup_remote_object(self, guid: str):
    return self._channels[guid].object

  def create_remote_object(self, type: str, guid: str, params: Dict):
    channel = Channel(self, type, guid)
    self._channels[guid] = channel
    result = None
    if type == 'browserType':
      result = BrowserType(channel)
    if type == 'browser':
      result = Browser(channel)
    if type == 'context':
      browser = self._channels[params.get('browserGuid')]
      result = BrowserContext(browser.object, channel)
    if type == 'elementHandle':
      page = self._channels[params.get('pageGuid')]
      result = ElementHandle(page.object, channel)
    if type == 'page':
      context = self._channels[params.get('contextGuid')]
      result = Page(context.object, channel)
    channel.object = result
    return result

  async def _on_message(self, message: str) -> None:
    # print('RECV> %s' % len(message))
    msg = json.loads(message)
    if msg.get('method') == 'created':
      self.create_remote_object(msg.get('type'),  msg.get('guid'), msg.get('params'))
      return
    if msg.get('method') == 'disposed':
      self._channels.pop(msg.get('guid'))
      return
    if msg.get('id') in self._callbacks:
      callback = self._callbacks.pop(msg.get('id', -1))
      if msg.get('error'):
        callback.set_exception(msg.get('error'))
      else:
        result = msg.get('result')
        if result and 'guid' in result:
          remote_object = self.lookup_remote_object(result.get('guid'))
          callback.set_result(remote_object)
        else:
          callback.set_result(result)
    else:
      channel = self._channels.get(msg.get('guid'))
      method = msg.get('method', '')
      params = msg.get('params', {})
      if params and 'guid' in params:
        remote_object = self.lookup_remote_object(params.get('guid'))
        channel._on_message(method, remote_object)
      else:
        channel._on_message(method, params)


class Channel(EventEmitter):
  def __init__(self, connection: Connection, type: str, guid: str) -> None:
    super().__init__()
    self._connection = connection
    self._type = type
    self._guid = guid
    self.object = None

  def send(self, method: str, params: dict = None) -> Awaitable:
    return self._connection.send(self._type, method, self._guid, params)

  def _on_message(self, method: str, params: Dict):
    self.emit(method, params)

class ElementHandle:
  def __init__(self, page: 'Page', channel: Channel) -> None:
    self._channel = channel
    self._page = page

  async def click(self, options: dict = None) -> None:
    await self._channel.send('click', dict(options=options))

  async def textContent(self) -> str: 
    return await self._channel.send('textContent')

class Page(EventEmitter):
  def __init__(self, context: "BrowserContext", channel: Channel) -> None:
    super().__init__()
    self._context = context
    self._context._pages.append(self)
    self._context.emit('page', self)
    self._channel = channel
    self._channel.on('close', lambda _: self._onClose())

  async def click(self, selector: str, options: dict = None) -> None:
    await self._channel.send('click', dict(selector=selector, options=options))

  async def close(self, options: dict = None) -> None:
    await self._channel.send('close', dict(options=options))

  async def goto(self, url: str, options: dict = None) -> None:
    await self._channel.send('goto', dict(url=url, options=options))

  async def querySelector(self, selector: str) -> Awaitable:
    return await self._channel.send('querySelector', dict(selector=selector))

  async def screenshot(self, options: dict = None) -> None:
    await self._channel.send('screenshot', dict(options=options))

  async def title(self) -> str:
    return await self._channel.send('title')

  def _onClose(self) -> None:
    self._context._pages.remove(self)
    self.emit('close', self)


class BrowserContext(EventEmitter):
  def __init__(self, browser: "Browser", channel: Channel) -> None:
    super().__init__()
    self._channel = channel
    self._browser = browser
    self._browser._contexts.append(self)
    self._pages: List[Page] = list()
    self._channel.on('close', lambda _: self._onClose())

  async def close(self) -> None:
    return await self._channel.send('close')

  async def new_page(self) -> None:
    return await self._channel.send('newPage')

  def pages(self) -> List[Page]:
    return self._pages

  def _onClose(self) -> None:
    self._browser._contexts.remove(self)
    self.emit('close', self)


class Browser(EventEmitter):
  def __init__(self, channel: Channel) -> None:
    super().__init__()
    self._contexts: List[BrowserContext] = list()
    self._channel = channel

  def contexts(self) -> List[BrowserContext]:
    return self._contexts

  async def new_context(self, options: dict = None) -> None:
    return await self._channel.send('newContext', dict(options=options))

  async def new_page(self, options: dict = None) -> None:
    return await self._channel.send('newPage', dict(options=options))

  async def close(self) -> None:
    await self._channel.send('close')


class BrowserType:
  def __init__(self, channel: Channel) -> None:
    self._channel = channel

  async def launch(self, options: dict = None) -> Browser:
    return await self._channel.send('launch', dict(options=options))

class Playwright:
  async def init(self) -> None:
    self.loop = asyncio.get_event_loop()
    self._proc = await asyncio.create_subprocess_exec(
        '/Users/pfeldman/.nvm/versions/node/v12.6.0/bin/node', 'lib/cli/index', 'serve',
      stdin=asyncio.subprocess.PIPE,
      stdout=asyncio.subprocess.PIPE,
      stderr=asyncio.subprocess.PIPE)
    self._connection = Connection(self._proc.stdout, self._proc.stdin, self.loop)
    self.chromium = self._connection.create_remote_object('browserType', 'chromium', dict())
    self.firefox = self._connection.create_remote_object('browserType', 'firefox', dict())
    self.webkit = self._connection.create_remote_object('browserType', 'webkit', dict())

  async def dispose(self) -> None:
    self._proc.kill()
    await self._proc.wait()


async def obtainPlaywright() -> Awaitable:
  playwright = Playwright()
  await playwright.init()
  return playwright


async def run():
    playwright = await obtainPlaywright()
    browser = await playwright.chromium.launch()
    context = await browser.new_context(dict(viewport=None))
    print('Pages: %d' % len(context.pages()))

    page1 = await context.new_page()
    await page1.goto('https://example.com')
    print(await page1.title())
    print('Pages: %d' % len(context.pages()))
    # await page1.screenshot(dict(path='example.png'))

    page2 = await context.new_page()
    await page2.goto('https://webkit.org')
    print(await page2.title())
    print('Pages: %d' % len(context.pages()))

    body1 = await page1.querySelector('body')
    print(await body1.textContent())

    print('Closing page 1')
    await page1.close()
    print('Pages: %d' % len(context.pages()))

    print('Contexts: %d' % len(browser.contexts()))
    print('Closing context')
    await context.close()
    print('Contexts: %d' % len(browser.contexts()))

    await browser.close()
    await playwright.dispose()

asyncio.run(run())
