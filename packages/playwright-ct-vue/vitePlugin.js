/**
 * Copyright (c) Microsoft Corporation.
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

const glob = require('glob');
const path = require('path');

const header = [`import { registerComponent } from '@playwright/ct-vue'`]

module.exports = () => {
  return {
    async resolveId(source, importer, options) {
      console.log(source, importer, options);
      return null;
    },

    configResolved: async options => {
      console.log(options.root);
    },

    transformIndexHtml(html) {
      console.log('TRANSFORM', html);
      return `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <link rel="icon" href="/favicon.ico" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Tests</title>
        </head>
        <body>
          <div id="app"></div>
          <script type="module" src="src/playwright.components.js"></script>
        </body>
      </html>`;
    },

    load: async id => {
      const index = id.indexOf('playwright.components.js');
      const base = id.substring(0, index);
      if (index !== -1) {
        console.log('==== WE ARE RELOADING THE FILE')
        const result = await new Promise((f, r) => glob(base + '**/*.vue', (error, matches) => {
          if (error)
            r(error);
          else
            f(matches);
        }));
        const files = result.map(f => path.relative(base, f));
        const imports = [];
        const registrations = [];
        for (const file of files) {
          const name = path.basename(file.replace(/\.vue$/, ''));
          imports.push(`import ${name} from './${file}';`);
          registrations.push(`registerComponent('${name}', ${name});`);
        }
        const gallery = [...header, ...imports, ...registrations].join('\n');
        return gallery;
      }
      return null;
    }
  };
};
