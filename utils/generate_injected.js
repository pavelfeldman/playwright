#!/usr/bin/env node
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
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

// @ts-check

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const esbuild = require('esbuild');

const injectedScripts = [
  path.join(ROOT, 'packages', 'playwright-core', 'src', 'server', 'injected', 'utilityScript.ts'),
  path.join(ROOT, 'packages', 'playwright-core', 'src', 'server', 'injected', 'injectedScript.ts'),
  path.join(ROOT, 'packages', 'playwright-core', 'src', 'server', 'injected', 'consoleApi.ts'),
  path.join(ROOT, 'packages', 'playwright-core', 'src', 'server', 'injected', 'recorder.ts'),
  path.join(ROOT, 'packages', 'playwright-core', 'src', 'server', 'injected', 'fakeTimers.ts'),
];

const modulePrefix = `
var __export = (target, all) => {for (var name in all) target[name] = all[name];};
var __toCommonJS = mod => ({ ...mod, __esModule: true });
`;

async function replaceEsbuildHeader(content, outFileJs) {
  const sourcesStart = content.indexOf('// packages/playwright-core/src/server');
  const nodeModulesStart = content.indexOf('// node_modules');
  if (sourcesStart === -1)
    throw new Error(`Did not find start of bundled code in ${outFileJs}`);
  const start = Math.min(sourcesStart, nodeModulesStart);

  const preamble = content.substring(0, start);
  // Replace standard esbuild definition with our own which do not depend on builtins.
  // See https://github.com/microsoft/playwright/issues/17029
  if (preamble.indexOf('__toCommonJS') !== -1) {
    content = modulePrefix + content.substring(start);
    await fs.promises.writeFile(outFileJs, content);
  }
  return content;
}

/**
 * @type {import('esbuild').Plugin}
 */
const utilPlugin = {
  name: 'util',

  setup(build) {
    build.onResolve({ filter: /^util$/ }, args => ({
      path: args.path,
      namespace: 'util-ns',
    }));
    build.onLoad({ filter: /.*/, namespace: 'util-ns' }, () => ({
      contents: '{}',
      loader: 'json',
    }));
  },
};

(async () => {
  const generatedFolder = path.join(ROOT, 'packages', 'playwright-core', 'src', 'generated');
  await fs.promises.mkdir(generatedFolder, { recursive: true });
  for (const injected of injectedScripts) {
    const outdir = path.join(ROOT, 'packages', 'playwright-core', 'lib', 'server', 'injected', 'packed');
    await esbuild.build({
      entryPoints: [injected],
      bundle: true,
      outdir,
      format: 'cjs',
      platform: 'browser',
      target: 'ES2019',
      plugins: [utilPlugin],
    });
    const baseName = path.basename(injected);
    const outFileJs = path.join(outdir, baseName.replace('.ts', '.js'));
    let content = await fs.promises.readFile(outFileJs, 'utf-8');
    content = await replaceEsbuildHeader(content, outFileJs);
    const newContent = `export const source = ${JSON.stringify(content)};`;
    await fs.promises.writeFile(path.join(generatedFolder, baseName.replace('.ts', 'Source.ts')), newContent);
  }
})();
