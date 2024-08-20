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

import type * as actions from './recorder/recorderActions';

export const describeElement = (elementInfo: actions.ElementInfo) => {
  return `
- A user performed action on ELEMENT on a given PAGE.
- Provide human-readable DESCRIPTION of the ELEMENT on a given PAGE so that the user could find this ELEMENT given the PAGE and the DESCRIPTION.
- Do not return HTML tags, description should be user-friendly.
- Make your DESCRIPTION resilient to changes. Some things in the page will change and your DESCRIPTION should be still be good enough for the user to find the element.
- Do not include details that usually change over time: timestamps, quantities, numeric values, etc in DESCRIPTION.
- If your DESCRIPTION is ambiguous (can point to more than one ELEMENT), provide unique context for the ELEMENT in a form of the text surrounding ELEMENT as a part of DESCRIPTION.
- Respond with the DESCRIPTION only, no other words, markup or stray text, only the command.

Example:
Add to cart button

ELEMENT: ${elementInfo.tag}
PAGE:
${elementInfo.markup}
`;
};

export const pickAction = (command: string, markup: string) => `
- Perform COMMAND on a given PAGE.
- For that return action to perform and element id to perform action on. Also provide param if available.
- Respond with JSON only, no other words, markup or stray text, conform to this schema.

type Response = {
  id: string;
  action: 'click' | 'fill' | 'press' | 'select' | 'check' | 'uncheck';
  param?: string;
}

Example:
{ "id": "25", "action": "click" }

Example:
{ "id": "30", "action": "fill", "param": "foo" }

COMMAND: ${command}
PAGE:
${markup}
`;

export type PickActionResponse = {
  id: string;
  action: 'click' | 'fill' | 'press' | 'select' | 'check' | 'uncheck';
  param?: string;
};
