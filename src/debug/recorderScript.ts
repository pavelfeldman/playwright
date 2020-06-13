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

import * as dom from '../dom';
import { Formatter, formatColors } from '../utils/formatter';
import { Action, NavigationSignal, actionTitle } from './recorderActions';

export class Script {
  private _lastAction: Action | undefined;

  addAction(action: Action) {
    let restoreCursor = false;
    if (this._lastAction && action.name === 'fill' && this._lastAction.name === 'fill') {
      if (action.selector === this._lastAction.selector)
        restoreCursor = true;
    }
    if (this._lastAction && action.name === 'click' && this._lastAction.name === 'click') {
      if (action.selector === this._lastAction.selector && action.clickCount > this._lastAction.clickCount)
        restoreCursor = true;
    }
    for (const name of ['check', 'uncheck']) {
      if (this._lastAction && action.name === name && this._lastAction.name === 'click') {
        if ((action as any).selector === (this._lastAction as any).selector)
          restoreCursor = true;
      }
    }
    this._lastAction = action;
    if (restoreCursor)
      console.log('\x1B[u RESTORE ' + this.generateAction(action));
    else
      console.log('\x1B[s RESTORE ' + this.generateAction(action));
  }

      // lastAction = action;
      // console.log('\x1B[s');
      // console.log('\x1B[u');
      // console.log(this._script.generateAction(action));
    
      // _printScript() {
      //   console.log(this._script.generate('chromium'));  // eslint-disable-line no-console
      // }

  // generate(browserType: string) {
  //   const formatter = new Formatter();
  //   const { cst, fnc, kwd, str } = formatColors;

  //   formatter.add(`
  //     ${kwd('const')} { ${cst('chromium')}, ${cst('firefox')}, ${cst('webkit')} } = ${fnc('require')}(${str('playwright')});

  //     (${kwd('async')}() => {
  //       ${kwd('const')} ${cst('browser')} = ${kwd('await')} ${cst(`${browserType}`)}.${fnc('launch')}();
  //       ${kwd('const')} ${cst('page')} = ${kwd('await')} ${cst('browser')}.${fnc('newPage')}();
  //   `);

  //   for (const action of this._compact()) {
  //     formatter.newLine();
  //     this._generateAction(formatter, action);
  //   }

  //   formatter.add(`
  //     })();
  //   `);

  //   return formatter.format();
  // }

  generateAction(action: Action): string {
    const formatter = new Formatter();
    this._generateAction(formatter, action);
    return formatter.format();
  }

  private _generateAction(formatter: Formatter, action: Action) {
    const { cst, cmt, fnc, kwd, prp, str } = formatColors;
    formatter.add(cmt(actionTitle(action)));
    let navigationSignal: NavigationSignal | undefined;
    if (action.name !== 'navigate' && action.signals && action.signals.length)
      navigationSignal = action.signals[action.signals.length - 1];

    if (navigationSignal) {
      formatter.add(`${kwd('await')} ${cst('Promise')}.${fnc('all')}([
        ${cst('page')}.${fnc('waitForNavigation')}({ ${prp('url')}: ${str(navigationSignal.url)} }),`);
    }

    const subject = action.frameUrl ?
      `${cst('page')}.${fnc('frame')}(${formatObject({ url: action.frameUrl })})` : cst('page');

    const prefix = navigationSignal ? '' : kwd('await') + ' ';
    const suffix = navigationSignal ? '' : ';';
    switch (action.name)  {
      case 'click': {
        let method = 'click';
        if (action.clickCount === 2)
          method = 'dblclick';
        const modifiers = toModifiers(action.modifiers);
        const options: dom.ClickOptions = {};
        if (action.button !== 'left')
          options.button = action.button;
        if (modifiers.length)
          options.modifiers = modifiers;
        if (action.clickCount > 2)
          options.clickCount = action.clickCount;
        const optionsString = formatOptions(options);
        formatter.add(`${prefix}${subject}.${fnc(method)}(${str(action.selector)}${optionsString})${suffix}`);
        break;
      }
      case 'check':
        formatter.add(`${prefix}${subject}.${fnc('check')}(${str(action.selector)})${suffix}`);
        break;
      case 'uncheck':
        formatter.add(`${prefix}${subject}.${fnc('uncheck')}(${str(action.selector)})${suffix}`);
        break;
      case 'fill':
        formatter.add(`${prefix}${subject}.${fnc('fill')}(${str(action.selector)}, ${str(action.text)})${suffix}`);
        break;
      case 'press': {
        const modifiers = toModifiers(action.modifiers);
        const shortcut = [...modifiers, action.key].join('+');
        formatter.add(`${prefix}${subject}.${fnc('press')}(${str(action.selector)}, ${str(shortcut)})${suffix}`);
        break;
      }
      case 'navigate':
        formatter.add(`${prefix}${subject}.${fnc('goto')}(${str(action.url)})${suffix}`);
        break;
      case 'select':
        formatter.add(`${prefix}${subject}.${fnc('select')}(${str(action.selector)}, ${formatObject(action.options.length > 1 ? action.options : action.options[0])})${suffix}`);
        break;
    }
    if (navigationSignal)
      formatter.add(`]);`);
  }
}

function formatOptions(value: any): string {
  const keys = Object.keys(value);
  if (!keys.length)
    return '';
  return ', ' + formatObject(value);
}

function formatObject(value: any): string {
  const { prp, str } = formatColors;
  if (typeof value === 'string')
    return str(value);
  if (Array.isArray(value))
    return `[${value.map(o => formatObject(o)).join(', ')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length)
      return '{}';
    const tokens: string[] = [];
    for (const key of keys)
      tokens.push(`${prp(key)}: ${formatObject(value[key])}`);
    return `{${tokens.join(', ')}}`;
  }
  return String(value);
}

function toModifiers(modifiers: number): ('Alt' | 'Control' | 'Meta' | 'Shift')[] {
  const result: ('Alt' | 'Control' | 'Meta' | 'Shift')[] = [];
  if (modifiers & 1)
    result.push('Alt');
  if (modifiers & 2)
    result.push('Control');
  if (modifiers & 4)
    result.push('Meta');
  if (modifiers & 8)
    result.push('Shift');
  return result;
}
