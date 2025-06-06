---
id: protractor
title: "Migrating from Protractor"
---

<!-- TOC -->

## Migration Principes

- No need for "webdriver-manager" / Selenium.
- Protractor’s [ElementFinder] ⇄ [Playwright Test Locator](./api/class-locator)
- Protractor’s [`waitForAngular`] ⇄ Playwright Test [auto-waiting](./actionability.md)
- Don’t forget to await in Playwright Test

## Cheat Sheet

| Protractor                                        | Playwright Test                         |
|---------------------------------------------------|-----------------------------------------|
| `element(by.buttonText('...'))`                   | `page.locator('button, input[type="button"], input[type="submit"] >> text="..."')` |
| `element(by.css('...'))`                          | `page.locator('...')`                   |
| `element(by.cssContainingText('..1..', '..2..'))` | `page.locator('..1.. >> text=..2..')`   |
| `element(by.id('...'))`                           | `page.locator('#...')`                  |
| `element(by.model('...'))`                        | `page.locator('[ng-model="..."]')`      |
| `element(by.repeater('...'))`                     | `page.locator('[ng-repeat="..."]')`     |
| `element(by.xpath('...'))`                        | `page.locator('xpath=...')`             |
| `element.all`                                     | `page.locator`                          |
| `browser.get(url)`                                | `await page.goto(url)`                  |
| `browser.getCurrentUrl()`                         | `page.url()`                            |

## Example

Protractor:

```js
describe('angularjs homepage todo list', function() {
  it('should add a todo', function() {
    browser.get('https://angularjs.org');

    element(by.model('todoList.todoText')).sendKeys('first test');
    element(by.css('[value="add"]')).click();

    var todoList = element.all(by.repeater('todo in todoList.todos'));
    expect(todoList.count()).toEqual(3);
    expect(todoList.get(2).getText()).toEqual('first test');

    // You wrote your first test, cross it off the list
    todoList.get(2).element(by.css('input')).click();
    var completedAmount = element.all(by.css('.done-true'));
    expect(completedAmount.count()).toEqual(2);
  });
});
```

Line-by-line migration to Playwright Test:


```js
const { test, expect } = require('@playwright/test'); // 1

test.describe('angularjs homepage todo list', function() {
  test('should add a todo', async function({page}) { // 2, 3
    await page.goto('https://angularjs.org'); // 4

    await page.locator('[ng-model="todoList.todoText"]').fill('first test');
    await page.locator('[value="add"]').click();

    var todoList = page.locator('[ng-repeat="todo in todoList.todos"]'); // 5
    await expect(todoList).toHaveCount(3);
    await expect(todoList.nth(2)).toHaveText('first test', {
      useInnerText: true,
    });

    // You wrote your first test, cross it off the list
    await todoList.nth(2).locator('input').click();
    var completedAmount = page.locator('.done-true');
    await expect(completedAmount).toHaveCount(2);
  });
}
```

Migration highlights (see inline comments in the Playwright Test code snippet):

1. Each Playwright Test file has explicit import of the `test` and `expect` functions
1. Test function is marked with `async`
1. Playwright Test is given a `page` as one of its parameters. This is one of the many [useful fixtures](./api/class-fixtures) in Playwright Test.
1. Almost all Playwright calls are prefixed with `await`
1. Locator creation with [`method: Page.locator`] is one of the few methods that is sync.

## Polyfilling `waitForAngular`

Playwright Test has built-in [auto-waiting](./actionability.md) that makes protractor's [`waitForAngular`] unneeded in general case.

However, it might come handy in some edge cases.
Here's how to polyfill `waitForAngular` function in Playwright Test:

1. Make sure you have protractor installed in your package.json
1. Polyfill function

    ```js
    async function waitForAngular(page) {
    ​const clientSideScripts = require('protractor/built/clientsidescripts.js');

    ​async function executeScriptAsync(page, script, ...scriptArgs) {
      ​await page.evaluate(`
        ​new Promise((resolve, reject) => {
          ​const callback = (errMessage) => {
            ​if (errMessage)
              ​reject(new Error(errMessage));
            ​else
              ​resolve();
          ​};
          ​(function() {${script}}).apply(null, [...${JSON.stringify(scriptArgs)}, callback]);
        ​})
      ​`);
    ​}

    ​await executeScriptAsync(page, clientSideScripts.waitForAngular, '');
    }
    ```

1. Polyfill usage

    ```js
    const page = await context.newPage();
    await page.goto('https://example.org');
    await waitForAngular(page);
    ```
 
## Playwright Test Super Powers

Once you're on Playwright Test, you get a lot!

- Full zero-configuration TypeScript support
- Run tests across **all web engines** (Chrome, Firefox, Safari) on **any popular operating system** (Windows, MacOS, Ubuntu)
- Full support for multiple origins, [(i)frames](./api/class-frame), [tabs and contexts](./multi-pages)
- Run tests in parallel across multiple browsers
- Built-in test artifact collection: [video recording](./test-configuration#record-video), [screenshots](./test-configuration#automatic-screenshots) and [playwright traces](./test-configuration#record-test-trace)

Also you get all these ✨ awesome tools ✨ that come bundled with Playwright Test:
- [Playwright Inspector](./inspector)
- [Playwright Test Code generation](./auth#code-generation)
- [Playwright Tracing](./trace-viewer) for post-mortem debugging

## Further Reading

Learn more about Playwright Test runner:

- [Getting Started](./intro)
- [Fixtures](./test-fixtures)
- [Locators](./api/class-locator)
- [Selectors](./selectors)
- [Assertions](./test-assertions)
- [Auto-waiting](./actionability)

[ElementFinder]: https://www.protractortest.org/#/api?view=ElementFinder
[`waitForAngular`]: https://www.protractortest.org/#/api?view=ProtractorBrowser.prototype.waitForAngular
