/**
 * Copyright Microsoft Corporation. All rights reserved.
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

import type { FSWatcher as CFSWatcher } from 'chokidar';
import { collectAffectedTestFiles } from '../common/compilationCache';
import type { FullConfigInternal, FullProjectInternal } from '../common/types';
import type { Matcher } from '../util';
import { createFileMatcher, createFileMatcherFromArguments } from '../util';
import { chokidar } from '../utilsBundle';
import { buildProjectsClosure, filterProjects } from './projectUtils';

export class FSWatcher {
  private _dirtyTestFiles = new Map<FullProjectInternal, Set<string>>();
  private _notifyDirtyFiles: (() => void) | undefined;
  private _watcher: CFSWatcher | undefined;
  private _timer: NodeJS.Timeout | undefined;

  async update(config: FullConfigInternal) {
    const commandLineFileMatcher = config._internal.cliArgs.length ? createFileMatcherFromArguments(config._internal.cliArgs) : () => true;
    const projects = filterProjects(config.projects, config._internal.cliProjectFilter);
    const projectClosure = buildProjectsClosure(projects);
    const projectFilters = new Map<FullProjectInternal, Matcher>();
    for (const project of projectClosure) {
      const testMatch = createFileMatcher(project.testMatch);
      const testIgnore = createFileMatcher(project.testIgnore);
      projectFilters.set(project, file => {
        if (!file.startsWith(project.testDir) || !testMatch(file) || testIgnore(file))
          return false;
        return project._internal.type === 'dependency' || commandLineFileMatcher(file);
      });
    }

    if (this._timer)
      clearTimeout(this._timer);
    if (this._watcher)
      await this._watcher.close();

    this._watcher = chokidar.watch(projectClosure.map(p => p.testDir), { ignoreInitial: true }).on('all', async (event, file) => {
      if (event !== 'add' && event !== 'change')
        return;

      const testFiles = new Set<string>();
      collectAffectedTestFiles(file, testFiles);
      const testFileArray = [...testFiles];

      let hasMatches = false;
      for (const [project, filter] of projectFilters) {
        const filteredFiles = testFileArray.filter(filter);
        if (!filteredFiles.length)
          continue;
        let set = this._dirtyTestFiles.get(project);
        if (!set) {
          set = new Set();
          this._dirtyTestFiles.set(project, set);
        }
        filteredFiles.map(f => set!.add(f));
        hasMatches = true;
      }

      if (!hasMatches)
        return;

      if (this._timer)
        clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        this._notifyDirtyFiles?.();
      }, 250);
    });

  }

  async onDirtyTestFiles(): Promise<void> {
    if (this._dirtyTestFiles.size)
      return;
    await new Promise<void>(f => this._notifyDirtyFiles = f);
  }

  takeDirtyTestFiles(): Map<FullProjectInternal, Set<string>> {
    const result = this._dirtyTestFiles;
    this._dirtyTestFiles = new Map();
    return result;
  }
}
