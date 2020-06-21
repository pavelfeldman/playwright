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
from types import SimpleNamespace
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

  def send(self, guid: str, method: str, params: dict = None) -> Awaitable:
    if params is None:
      params = dict()
    self._lastId += 1
    id = self._lastId
    msg = json.dumps(dict(id=id, method=method, params=params, guid=guid))
    self._output.write(bytes(msg, 'utf-8'))
    self._output.write(b'\0')
    # print('SEND> %s' % msg)
    callback = self.loop.create_future()
    self._callbacks[id] = callback
    return callback

  def lookup_remote_object(self, guid: str):
    return self._channels[guid].object

  def create_remote_object(self, type: str, guid: str):
    channel = Channel(self, type, guid)
    self._channels[guid] = channel
    if type == 'browserType':
      return BrowserType(channel)
    if type == 'browser':
      return Browser(channel)
    if type == 'context':
      return BrowserContext(channel)
    if type == 'page':
      return Page(channel)
    if type == 'frame':
      return Frame(channel)
    if type == 'elementHandle':
      return ElementHandle(channel)

  async def _on_message(self, message: str) -> None:
    # print('RECV> %s' % message)
    msg = json.loads(message)
    if msg.get('method') == '__create__':
      self.create_remote_object(msg.get('type'),  msg.get('guid'))
      return
    if msg.get('method') == '__init__':
      self.lookup_remote_object(msg.get('guid'))._initialize(msg.get('params'), self._channels)
      return
    if msg.get('method') == '__dispose__':
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
    return self._connection.send(self._guid, method, params)

  def _on_message(self, method: str, params: Dict):
    self.emit(method, params)


class ChannelOwner(EventEmitter):
  def __init__(self, channel: Channel) -> None:
    super().__init__()
    self._channel = channel
    channel.object = self


class BrowserType(ChannelOwner):

  def __init__(self, channel: Channel) -> None:
    self._channel = channel

  def _initialize(self, params: Dict, channels: Dict[int, Channel]) -> None: 
    return

  async def launch(self, options: dict = None) -> 'Browser':
    return await self._channel.send('launch', dict(options=options))


class Browser(ChannelOwner):

  def __init__(self, channel: Channel) -> None:
    super().__init__(channel)

  def _initialize(self, params: Dict, channels: Dict[int, Channel]) -> None: 
    self._contexts: List['BrowserContext'] = list()
    self._channel.on('contextCreated', lambda context: self._contexts.append(context))
    self._channel.on('contextClosed', lambda context: self._contexts.remove(context))

  def contexts(self) -> List['BrowserContext']:
    return self._contexts

  async def newContext(self, options: dict = None) -> None:
    return await self._channel.send('newContext', dict(options=options))

  async def newPage(self, options: dict = None) -> None:
    return await self._channel.send('newPage', dict(options=options))

  async def close(self) -> None:
    await self._channel.send('close')


class BrowserContext(ChannelOwner):

  Events = SimpleNamespace(
      Close='close',
      Page='page',
  )

  def __init__(self, channel: Channel) -> None:
    super().__init__(channel)

  def _initialize(self, params: Dict, channels: Dict[int, Channel]) -> None: 
    self._browser = channels[params.get('browserGuid')].object
    self._pages: List['Page'] = list()
    self._channel.on('pageCreated', lambda page: self._on_page_created(page))
    self._channel.on('pageClosed', lambda page: self._pages.remove(page))
    self._channel.on('close', lambda _: self.emit(BrowserContext.Events.Close))

  async def close(self) -> None:
    return await self._channel.send('close')

  async def newPage(self) -> None:
    return await self._channel.send('newPage')

  def pages(self) -> List['Page']:
    return self._pages

  def _on_page_created(self, page: 'Page') -> None:
    self._pages.append(page)
    self.emit(BrowserContext.Events.Page, page)


class Page(ChannelOwner):

  Events = SimpleNamespace(
      Close='close',
      FrameNavigated='framenavigated'
  )

  def __init__(self, channel: Channel) -> None:
    super().__init__(channel)

  def _initialize(self, params: Dict, channels: Dict[int, Channel]) -> None: 
    self._context = channels[params.get('contextGuid')].object
    self._main_frame = channels[params.get('mainFrameGuid')].object

    self._frames: List[Frame] = []
    for frame_guid in params.get('frameGuids'):
      self._frames.append(channels[frame_guid].object)

    self._channel.on('frameAttached', lambda frame: self._frames.append(frame))
    self._channel.on('frameDetached', lambda frame: self._frames.remove(frame))
    self._channel.on('close', lambda _: self.emit(Page.Events.Close))

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

  @property
  def mainFrame(self) -> 'Frame':
    return self._main_frame

  @property
  def frames(self) -> List['Frame']:
    return self._frames


class Frame(ChannelOwner):

  def __init__(self, channel: Channel) -> None:
    super().__init__(channel)

  def _initialize(self, params: Dict, channels: Dict[int, Channel]) -> None: 
    self._page = channels[params.get('pageGuid')].object
    self._name = params.get('name')
    self._url = params.get('url')
    self._is_detached = params.get('isDetached')

    self._parent_frame: Optional[Frame] = None
    if params.get('parentFrameGuid'):
      self._parent_frame = channels[params.get('parentFrameGuid')].object

    self._child_frames: List[Frame] = []
    for child_frame_guid in params.get('childFrameGuids'):
      self._child_frames.append(channels[child_frame_guid].object)
    self._channel.on('frameNavigated', lambda url: self._onFrameNavigated(url))
    self._channel.on('frameAttached', lambda frame: self._child_frames.append(frame))
    self._channel.on('frameDetached', lambda frame: self._child_frames.remove(frame))

  @property
  def name(self) -> str:
    return self._name

  @property
  def url(self) -> str:
    return self._url

  @property
  def parentFrame(self) -> Optional['Frame']:
    return self._parent_frame

  @property
  def childFrames(self) -> List['Frame']:
    return list(self._child_frames)

  @property
  def isDetached(self) -> bool:
    return self._is_detached

  def _onFrameNavigated(self, url: str) -> None:
    self._url = url
    self._page.emit(Page.Events.FrameNavigated, self)


class ElementHandle(ChannelOwner):

  def __init__(self, channel: Channel) -> None:
    super().__init__(channel)

  def _initialize(self, params: Dict, channels: Dict[int, Channel]) -> None: 
    self._frame = channels[params.get('frameGuid')].object

  async def click(self, options: dict = None) -> None:
    await self._channel.send('click', dict(options=options))

  async def textContent(self) -> str: 
    return await self._channel.send('textContent')


class Playwright:
  async def init(self) -> None:
    self.loop = asyncio.get_event_loop()
    self._proc = await asyncio.create_subprocess_exec(
        '/Users/pfeldman/.nvm/versions/node/v12.6.0/bin/node', 'lib/cli/index', 'serve',
      stdin=asyncio.subprocess.PIPE,
      stdout=asyncio.subprocess.PIPE,
      stderr=asyncio.subprocess.PIPE)
    self._connection = Connection(self._proc.stdout, self._proc.stdin, self.loop)
    self.chromium = self._connection.create_remote_object('browserType', 'chromium')
    self.firefox = self._connection.create_remote_object('browserType', 'firefox')
    self.webkit = self._connection.create_remote_object('browserType', 'webkit')

  async def dispose(self) -> None:
    self._proc.kill()
    await self._proc.wait()


async def obtain_playwright() -> Awaitable:
  playwright = Playwright()
  await playwright.init()
  return playwright


async def run():
    playwright = await obtain_playwright()
    print('Launching browser...')
    browser = await playwright.chromium.launch()
    print('Creating context...')
    context = await browser.newContext(dict(viewport=None))
    print('Pages in context: %d' % len(context.pages()))

    print('\nCreating page1...')
    page1 = await context.newPage()
    page1.on(Page.Events.FrameNavigated, lambda frame: print('Frame navigated to %s' % frame.url))
    print('Navigating page1 to https://example.com...')
    await page1.goto('https://example.com')
    print('Page1 main frame url: %s' % page1.mainFrame.url)
    print('Page1 tile: %s' % await page1.title())
    print('Frames in page1: %d' % len(page1.frames))
    print('Pages in context: %d' % len(context.pages()))
    # await page1.screenshot(dict(path='example.png'))

    print('\nCreating page2...')
    page2 = await context.newPage()
    page2.on(Page.Events.FrameNavigated, lambda frame: print('Frame navigated to %s' % frame.url))
    print('Navigating page2 to https://webkit.org...')
    await page2.goto('https://webkit.org')
    print('Page2 tile: %s' % await page2.title())
    print('Pages in context: %d' % len(context.pages()))

    print('\nQuerying body...')
    body1 = await page1.querySelector('body')
    print('Body text %s' % await body1.textContent())

    print('Closing page1...')
    await page1.close()
    print('Pages in context: %d' % len(context.pages()))

    print('Navigating page2 to https://cnn.com...')
    await page2.goto('https://cnn.com')
    print('Page2 main frame url: %s' % page2.mainFrame.url)
    print('Page2 tile: %s' % await page2.title())
    print('Frames in page2: %d' % len(page2.frames))
    print('Pages in context: %d' % len(context.pages()))

    print('Contexts: %d' % len(browser.contexts()))
    print('Closing context...')
    await context.close()
    print('Contexts: %d' % len(browser.contexts()))

    print('Closing browser')
    await browser.close()
    await playwright.dispose()

asyncio.run(run())
