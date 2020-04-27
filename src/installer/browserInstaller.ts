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

import * as child_process from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { logPolitely } from '../helper';
import * as browserPaths from './browserPaths';
import { REGISTRY_APP_VERSION } from './registry/registryAppVersion';

const fsMkdirAsync = util.promisify(fs.mkdir.bind(fs));
const fsReadFileAsync = util.promisify(fs.readFile.bind(fs));
const fsExistsAsync = (path: string) => new Promise(f => fs.exists(path, f));

const baseDir = browserPaths.baseDir;
const registryAppFile = path.join(baseDir, 'registryApp.js');

async function updateRegistry() {
  if (!await fsExistsAsync(baseDir))
    await fsMkdirAsync(baseDir);

  try {
    const installedRegistry = (await fsReadFileAsync(registryAppFile)).toString();
    const installedVersion = parseInt(installedRegistry.match(/const\ VERSION\ =\ (\d+);/)![1], 10);
    logPolitely(`Installed registry version: ${installedVersion}`);
    logPolitely(`Current registry version:   ${REGISTRY_APP_VERSION}`);
    if (installedVersion >= REGISTRY_APP_VERSION)
      return;
  } catch (e) {
    // not installed.
  }

  logPolitely(`Installing version: ${REGISTRY_APP_VERSION}`);
  await new Promise(f => fs.copyFile(__filename, registryAppFile, f));
}

export async function installBrowser() {
  logPolitely('Using browsers location: ' + baseDir);
  await updateRegistry();
  const packageRoot = path.join(__dirname, '..', '..');
  const child = child_process.fork(registryAppFile, [ 'install', packageRoot ]);
  return new Promise(f => child.on('exit', f));
}
