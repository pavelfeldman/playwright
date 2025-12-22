import { test, expect } from '../fixtures';

test.use({
  agent: {
    provider: 'github',
    model: 'gpt-4.1',
  }
});

test.describe('Adding New Todos', () => {
  test('should add multiple todos', async ({ page }) => {
    page.on('agentturn', turn => {
      console.log('agentturn', turn.role, turn.message);
    })
    await page.perform(`Add "Buy groceries", todo item`);
    await page.perform(`Add "Walk the dog" todo item`);
    await page.perform(`Add "Read a book" todo item`);

    // await page.perform('Ensure all three todos appear in the list in order of creation. Use browser_expect_list_visible to verify the list. Do not report_result right away, call expectList tool. You must.');
    await expect(page.getByRole('list').getByRole('listitem')).toHaveText(['Buy groceries', 'Walk the dog', 'Read a book']);

    await page.perform(`Ensure each todo has an unchecked checkbox`);
    await page.perform(`Ensure counter shows "3 items left" (plural)`);
    await page.perform(`Ensure input field is cleared`);
  });
});
