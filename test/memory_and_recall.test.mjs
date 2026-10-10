import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listMemories,
  saveMemory,
  getMemoryById,
  deleteMemory,
  searchMemories,
  detectAndExtractMemories,
  recallContextForQuery,
} from '../src/server/memoryStore.js';
import { saveChat } from '../src/server/chatStore.js';

test('Memory Store & Cross-Chat Recall Unit Tests', async (t) => {
  await t.test('saves, lists, and retrieves a memory item', async () => {
    const memory = saveMemory({
      type: 'instruction',
      title: 'Always use Tailwind CSS',
      content: 'Never use inline styling; always style UI components with Tailwind CSS utility classes.',
      tags: ['ui', 'tailwind', 'styling'],
      pinned: true,
      source: 'test-suite',
    });

    assert.ok(memory.id, 'Memory should have a generated ID');
    assert.equal(memory.type, 'instruction');
    assert.equal(memory.title, 'Always use Tailwind CSS');
    assert.equal(memory.pinned, true);

    const found = getMemoryById(memory.id);
    assert.ok(found, 'Should find memory by ID');
    assert.equal(found.title, 'Always use Tailwind CSS');

    const all = listMemories({ type: 'instruction' });
    assert.ok(all.some((m) => m.id === memory.id), 'listMemories should contain saved item');

    // Clean up
    deleteMemory(memory.id);
  });

  await t.test('detects and extracts memories from natural user messages', async () => {
    // Instruction pattern
    const text1 = 'Remember that our API always requires Bearer authentication headers.';
    const detected1 = detectAndExtractMemories(text1);
    assert.ok(detected1.length > 0, 'Should detect explicit remember instruction');
    assert.equal(detected1[0].type, 'instruction');
    assert.ok(detected1[0].content.includes('Bearer authentication'));

    // Rule pattern
    const text2 = 'From now on, always format currencies in USD with two decimals.';
    const detected2 = detectAndExtractMemories(text2);
    assert.ok(detected2.length > 0, 'Should detect always rule');
    assert.equal(detected2[0].type, 'instruction');

    // User preference / fact pattern
    const text3 = 'My project is a high-frequency cryptocurrency arbitrage bot.';
    const detected3 = detectAndExtractMemories(text3);
    assert.ok(detected3.length > 0, 'Should detect user project fact');
    assert.equal(detected3[0].type, 'fact');

    // Code snippet marked to remember
    const text4 = 'Please save this reusable helper function:\n```typescript\nexport function calculatePnL(entry: number, exit: number): number {\n  return exit - entry;\n}\n```';
    const detected4 = detectAndExtractMemories(text4);
    assert.ok(detected4.length > 0, 'Should detect code snippet to remember');
    assert.equal(detected4[0].type, 'code');
    assert.ok(detected4[0].content.includes('calculatePnL'));
  });

  await t.test('searches memories semantically and by keyword', async () => {
    const memCode = saveMemory({
      type: 'code',
      title: 'MetaTrader 5 Order Execution Helper',
      content: '```python\nimport MetaTrader5 as mt5\ndef send_market_order(symbol, lot, order_type):\n    mt5.order_send(...)\n```',
      tags: ['mt5', 'python', 'trading'],
      pinned: false,
    });

    const searchResults = searchMemories('MetaTrader order script in python');
    assert.ok(searchResults.length > 0, 'Should return matching memory');
    assert.equal(searchResults[0].id, memCode.id, 'Top match should be the MT5 code memory');

    deleteMemory(memCode.id);
  });

  await t.test('recalls context across saved chats and memories', async () => {
    // Save a mock previous chat
    const testChat = await saveChat({
      title: 'Previous Risk Management Setup',
      messages: [
        { role: 'user', content: 'What is our maximum stop loss percentage on Forex pairs?' },
        {
          role: 'assistant',
          content: 'We set our maximum stop loss strictly to 1.5% per trade with a 1:2.5 risk reward ratio.',
        },
      ],
    });

    // Save a custom instruction
    const memRule = saveMemory({
      type: 'instruction',
      title: 'Trading Risk Guideline',
      content: 'Strict maximum risk per position is 1.5% of account balance.',
      pinned: true,
    });

    // Query asking about risk in a new chat
    const recalled = await recallContextForQuery('What was our stop loss and risk percentage rule?', {
      currentChatId: 'some-other-active-chat-id',
      maxMemories: 3,
      maxChatTurns: 2,
    });

    assert.ok(recalled.formattedContext, 'Formatted context should not be empty');
    assert.ok(
      recalled.formattedContext.includes('Trading Risk Guideline') ||
        recalled.formattedContext.includes('1.5%'),
      'Context should include the instruction'
    );
    assert.ok(
      recalled.formattedContext.includes('Previous Risk Management Setup') ||
        recalled.chatExcerptsRecalled.length > 0,
      'Context should recall the previous chat discussion'
    );

    // Clean up
    deleteMemory(memRule.id);
  });

  await t.test('default seed memories are generic and not pinned by default for new installs', () => {
    const list = listMemories();
    const seed = list.find((m) => m.id === 'seed-instruction-identity');
    if (seed) {
      assert.equal(seed.pinned, false, 'Default identity seed memory must not be pinned');
      assert.equal(seed.content.includes('algorithmic trading'), false, 'Default seed memory should be domain-agnostic');
    }
    const codeSeed = list.find((m) => m.id === 'seed-instruction-code-style');
    if (codeSeed) {
      assert.equal(codeSeed.pinned, false, 'Default code style seed memory must not be pinned');
    }
  });
});

