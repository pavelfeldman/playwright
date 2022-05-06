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

import type { FullConfig, Suite } from '../../types/testReporter';
import type { InlineConfig, Plugin } from 'vite';
import type { ComponentInfo } from '../tsxTransform';
import type { TestPlugin } from '../types';

import fs from 'fs';
import path from 'path';
import { parse, traverse, types as t } from '../babelBundle';
import { build, preview } from 'vite';
import { collectComponentUsages, componentInfo } from '../tsxTransform';

export function vitePlugin(
  name: string,
  registerSourceFile: string,
  frameworkPluginFactory: () => Plugin,
  viteConfig: InlineConfig = {},
  vitePort: number = 3100): TestPlugin {

  let teardownVite: () => Promise<void>;
  return {
    name,

    setup: async (config: FullConfig, configDirectory: string, suite: Suite) => {
      teardownVite = await setup(registerSourceFile, frameworkPluginFactory, configDirectory, suite, viteConfig, vitePort);
    },

    teardown: async () => {
      await teardownVite();
    },

    fixtures: require.resolve('./vitePluginFixtures')
  };
}

async function setup(registerSourceFile: string, frameworkPluginFactory: () => Plugin, configDirectory: string, suite: Suite, viteConfig: InlineConfig, vitePort: number) {
  process.env.PLAYWRIGHT_VITE_PLUGIN_GALLERY = `http://localhost:${vitePort}/playwright/index.html`;

  viteConfig.root = viteConfig.root || configDirectory;
  viteConfig.plugins = viteConfig.plugins || [
    frameworkPluginFactory()
  ];
  const files = new Set<string>();
  for (const project of suite.suites) {
    for (const file of project.suites)
      files.add(file.location!.file);
  }
  const registerSource = await fs.promises.readFile(registerSourceFile, 'utf-8');
  viteConfig.plugins.push(generateGalleryPlugin(registerSource, [...files]));
  viteConfig.configFile = viteConfig.configFile || false;
  viteConfig.define = viteConfig.define || {};
  viteConfig.define.__VUE_PROD_DEVTOOLS__ = true;
  viteConfig.css = viteConfig.css || {};
  viteConfig.css.devSourcemap = true;
  viteConfig.preview = { port: vitePort };
  viteConfig.build = {
    target: 'esnext',
    minify: false,
    rollupOptions: {
      treeshake: false,
      input: {
        index: path.join(viteConfig.root, 'playwright', 'index.html')
      },
    },
    sourcemap: true,
    outDir: viteConfig?.build?.outDir || path.join(viteConfig.root, './dist-pw/')
  };

  await build(viteConfig);
  const previewServer = await preview(viteConfig);

  const teardown = async () => {
    await new Promise<void>((f, r) => previewServer.httpServer.close(err => {
      if (err)
        r(err);
      else
        f();
    }));
  };
  return teardown;
}

const imports: Map<string, ComponentInfo> = new Map();

function generateGalleryPlugin(registerSource: string, files: string[]): Plugin {
  return {
    name: 'playwright:component-index',

    configResolved: async config => {

      for (const file of files) {
        const text = await fs.promises.readFile(file, 'utf-8');
        const ast = parse(text, { errorRecovery: true, plugins: ['typescript', 'jsx'], sourceType: 'module' });
        const components = collectComponentUsages(ast);

        traverse(ast, {
          enter: p => {
            if (t.isImportDeclaration(p.node)) {
              const importNode = p.node;
              if (!t.isStringLiteral(importNode.source))
                return;

              for (const specifier of importNode.specifiers) {
                if (!components.names.has(specifier.local.name))
                  continue;
                if (t.isImportNamespaceSpecifier(specifier))
                  continue;
                const info = componentInfo(specifier, importNode.source.value, file);
                imports.set(info.fullName, info);
              }
            }
          }
        });
      }
    },

    transform: async (content, id) => {
      if (!id.endsWith('playwright/index.ts') && !id.endsWith('playwright/index.tsx') && !id.endsWith('playwright/index.js'))
        return;

      const folder = path.dirname(id);
      const lines = [content, ''];
      lines.push(registerSource);

      for (const [alias, value] of imports) {
        const importPath = value.isModuleOrAlias ? value.importPath : './' + path.relative(folder, value.importPath).replace(/\\/g, '/');
        if (value.importedName)
          lines.push(`import { ${value.importedName} as ${alias} } from '${importPath}';`);
        else
          lines.push(`import ${alias} from '${importPath}';`);
      }

      lines.push(`register({ ${[...imports.keys()].join(',\n  ')} });`);
      return lines.join('\n');
    },
  };
}
