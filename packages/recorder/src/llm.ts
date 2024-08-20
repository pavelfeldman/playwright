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

import OpenAI from 'openai';
import type { Stream } from 'openai/streaming';

export type ChatMessage = {
  content: string;
  user: 'user' | 'assistant' | 'system';
};

export class Chat {
  private _history: ChatMessage[] = [];
  private _openai: OpenAI;

  constructor(readonly name: string) {
    this._openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async append(user: ChatMessage['user'], content: string) {
    this._history.push({ user, content });
  }

  async post(): Promise<AsyncIterable<string>> {
    return await this._sendChatRequest(this._history);
  }

  private async _sendChatRequest(history: ChatMessage[]): Promise<AsyncIterable<string>> {
    return await this._sendChatRequestOpenAI(history);
  }

  private async _sendChatRequestOpenAI(history: ChatMessage[]): Promise<AsyncIterable<string>> {
    const messages = history.map(m => ({ role: m.user, content: m.content }));
    const stream = await this._openai.chat.completions.create({
      messages,
      model: 'gpt-4o-2024-05-13',
      stream: true,
    });
    return translateOpenAIResponse(stream);
  }
}

export async function llm(prompt: string): Promise<AsyncIterable<string>> {
  const chat = new Chat('llm');
  await chat.append('user', prompt);
  return await chat.post();
}

async function* translateOpenAIResponse(stream: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>): AsyncIterable<string> {
  for  await (const chunk of stream)
    yield chunk.choices[0].delta.content ?? '';
}

export async function asString(stream: AsyncIterable<string>): Promise<string> {
  let result = '';
  for await (const chunk of stream)
    result += chunk;
  return result;
}
