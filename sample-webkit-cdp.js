const { webkit } = require('./packages/playwright-core');

(async () => {
  const browser = await webkit.connectOverCDP('ws://127.0.0.1:9225/');
  const [context] = browser.contexts();
  const [page] = context.pages();
  page.on('console', m => console.log(m));
  console.log('url:', page.url());
  // await page.evaluate(() => {
  //   document.body.innerHTML = `<button onclick="console.log('foo')">Submit2</button>`;
  // });
  // await page.getByRole('button').click();
  const longString = 'A'.repeat(100);
  console.log('======================' + await page.evaluate("'" + longString + "'.length"));
  await browser.close();
})().catch(err => {
  console.error(err);
  process.exit(1);
});
