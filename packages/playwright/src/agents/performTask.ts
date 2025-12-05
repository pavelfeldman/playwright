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

import fs from 'fs';

import { debug } from 'playwright-core/lib/utilsBundle';
import { z, zodToJsonSchema, Loop } from 'playwright-core/lib/mcpBundle';

import { identityBrowserContextFactory } from '../mcp/browser/browserContextFactory';
import { BrowserServerBackend } from '../mcp/browser/browserServerBackend';
import { defaultConfig } from '../mcp/browser/config';
import { wrapInClient } from '../mcp/sdk/server';

import type * as playwright from 'playwright-core';
import type * as lowireLoop from '@lowire/loop';
import type * as zod from 'zod';
import type { Page, TestInfo } from '../../types/test';

export type PerformTaskOptions = {
  provider?: 'github' | 'openai' | 'anthropic' | 'google';
  model?: string;
  maxTokens?: number;
  reasoning?: boolean;
  temperature?: number;
};

type PerformCache = {
  get: (task: string) => ((params: { page: playwright.Page }) => Promise<void>) | undefined;
  set: (task: string, code: string) => Promise<void>;
};

export type PerformTestCache = Record<string, (params: { page: Page }) => Promise<void>>;

const resultSchema = z.object({
  code: z.string().optional().describe(`
Generated code to perform the task using Playwright API.
Check out the <code> blocks and combine them. Should be presented in the following form:

perform(async ({ page }) => {
  // generated code here.
});
`),
  error: z.string().optional().describe('The error that occurred if execution failed.').optional(),
});

export async function performTask(cache: PerformCache, userTask: string, context: playwright.BrowserContext, options: PerformTaskOptions) {
  const cacheStatus = await performTaskFromCache(userTask, context, cache);
  if (cacheStatus === 'success')
    return;

  const backend = new BrowserServerBackend(defaultConfig, identityBrowserContextFactory(context));
  const client = await wrapInClient(backend, { name: 'Internal', version: '0.0.0' });
  const callTool: (params: { name: string, arguments: any}) => Promise<lowireLoop.ToolResult> = async params => {
    return await client.callTool(params) as lowireLoop.ToolResult;
  };

  const loop = new Loop(options.provider ?? 'github', {
    model: options.model ?? 'claude-sonnet-4.5',
    reasoning: options.reasoning,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    summarize: true,
    debug,
    callTool,
    tools: await backend.listTools(),
  });

  try {
    const result = await loop.run<zod.infer<typeof resultSchema>>(userTask, { resultSchema: zodToJsonSchema(resultSchema) as lowireLoop.Schema });
    if (result.code)
      await cache.set(userTask, result.code);
  } finally {
    await client.close();
  }
}

async function updatePerformCacheFile(existingCode: string, key: string, code: string, options?: PerformTaskOptions) {
  const loop = new Loop(options?.provider ?? 'github', {
    model: options?.model ?? 'claude-sonnet-4.5',
    reasoning: options?.reasoning,
    temperature: options?.temperature,
    maxTokens: options?.maxTokens,
    summarize: true,
    debug,
    callTool: async () => ({ content: [] }),
    tools: [],
  });

  const resultSchema = z.object({
    code: z.string().optional().describe(`Generated code`),
  });

  const task = `
- Create or update a perform file to include performCache block for the given task and code.
- Dedupe items with the same file, test, and task.
- Should produce code in the following format

<example>
const cache = {};
export default cache;

cache[<key>] = async ({ page }) => {
  // code
};

cache[<key 2>] = async ({ page }) => {
...
</example>

## Params for the new or updated performCache block
<file-content>${existingCode}</file-content>
<key>${key}</key>
<code>${code}</code>
`;

  const result = await loop.run<zod.infer<typeof resultSchema>>(task, { resultSchema: zodToJsonSchema(resultSchema) as lowireLoop.Schema });
  return result.code;
}

async function performTaskFromCache(userTask: string, context: playwright.BrowserContext, cache: PerformCache): Promise<'success' | 'cache-miss' | Error> {
  const code = cache.get(userTask);
  if (!code)
    return 'cache-miss';
  try {
    await code({ page: context.pages()[0] });
    return 'success';
  } catch (error) {
    return error;
  }
}

export function patchPageWithPerform(page: Page) {
  let cache: PerformCache;
  (page as any).setPerformCache = (c: PerformCache) => {
    cache = c;
  };

  page.perform = async (task: string) => {
    await performTask(cache, task, page.context(), {});
  };
}

export function createPerformCacheForTest(testInfo: TestInfo, performTestCache: PerformTestCache): PerformCache {
  const promptCacheFile = testInfo.file.replace('.spec.ts', '.cache.ts');
  let existingCode: string;

  return {
    get: (task: string) => {
      const key = `${testInfo.title} > ${task}`;
      return performTestCache[key];
    },

    set: async (task: string, code: string) => {
      const key = `${testInfo.title} > ${task}`;
      if (!existingCode)
        existingCode = await fs.promises.readFile(promptCacheFile, 'utf-8').catch(() => '');
      const newCode = await updatePerformCacheFile(existingCode, key, code);
      if (newCode && newCode !== existingCode) {
        await fs.promises.writeFile(promptCacheFile, newCode);
        existingCode = newCode;
      }
    },
  };
}
