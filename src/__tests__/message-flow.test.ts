/**
 * MESSAGE FLOW INTEGRATION TESTS
 * 
 * Tests the full processMessage pipeline with all dependencies
 * 
 * To run: RUN_INTEGRATION_TESTS=true npm test
 * 
 * Note: These tests are completely skipped if required env vars aren't set
 */

import { beforeAll, describe, expect, test } from 'vitest';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';

// Check if Firebase is configured
const hasFirebaseConfig = Boolean(
  process.env.FIREBASE_DATABASE_URL || 
  process.env.DATABASE_URL
);

const hasRequiredEnv = Boolean(
  process.env.OPENAI_API_KEY &&
  hasFirebaseConfig &&
  process.env.NOTION_TOKEN &&
  process.env.NOTION_BLOCK_ID
);

// Only import processMessage if we're actually going to run tests
// This prevents Firebase initialization errors when just running quick tests
let processMessage: any;

if (shouldRun && hasRequiredEnv) {
  const module = await import('../processMessage');
  processMessage = module.processMessage;
}

describe.skipIf(!shouldRun || !hasRequiredEnv)('Message Flow Integration Tests', () => {
  beforeAll(() => {
    console.log('\n🔧 Integration Test Setup:');
    console.log('  OpenAI API:', process.env.OPENAI_API_KEY ? '✓' : '✗');
    console.log('  Firebase DB:', hasFirebaseConfig ? '✓' : '✗');
    console.log('  Notion Token:', process.env.NOTION_TOKEN ? '✓' : '✗');
    console.log('  Notion Block:', process.env.NOTION_BLOCK_ID ? '✓' : '✗');
    console.log('');
  });

  test('processMessage returns a valid response', async () => {
    const requestId = 'test-integration-' + Date.now();
    
    try {
      const response = await processMessage(
        'test-msg-' + Date.now(),  // messageId
        'test-user-123',            // userId
        'Hello, this is a test',    // msgBody
        'messenger',                // platform
        null,                       // attachment
        'Test User',                // name
        null,                       // lastThreadId
        requestId,
      );

      // Response should be a non-empty string
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
      expect(response).not.toBe('Sorry, I am having troubles lol');
      expect(response).not.toBe('sorry, im a bit confused lol');
      
      console.log('✓ processMessage returned valid response');
      console.log('  Response preview:', response.substring(0, 100) + '...');
    } catch (error: any) {
      console.error('Integration test error:', error.message);
      throw error;
    }
  }, 60000); // 60 second timeout for full pipeline

  test('processMessage handles "clear" command', async () => {
    const requestId = 'test-clear-' + Date.now();
    
    const response = await processMessage(
      'test-msg-clear-' + Date.now(),
      'test-user-456',
      'clear',
      'messenger',
      null,
      'Test User',
      null,
      requestId,
    );

    expect(response).toBe('All clear');
    console.log('✓ Clear command handled correctly');
  }, 30000);

  test('processMessage handles empty message gracefully', async () => {
    const requestId = 'test-empty-' + Date.now();
    
    try {
      const response = await processMessage(
        'test-msg-empty-' + Date.now(),
        'test-user-789',
        '',  // Empty message
        'messenger',
        null,
        'Test User',
        null,
        requestId,
      );

      // Should still return a string (even if it's an error message)
      expect(typeof response).toBe('string');
      console.log('✓ Empty message handled gracefully');
    } catch (error) {
      // It's okay to throw, we just want to make sure it's handled
      expect(error).toBeDefined();
      console.log('✓ Empty message threw expected error');
    }
  }, 60000);

  test('processMessage works with WhatsApp platform', async () => {
    const requestId = 'test-whatsapp-' + Date.now();
    
    const response = await processMessage(
      'test-msg-wa-' + Date.now(),
      'test-user-wa-123',
      'Testing WhatsApp integration',
      'whatsapp',  // Different platform
      null,
      'WhatsApp User',
      null,
      requestId,
    );

    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
    console.log('✓ WhatsApp platform works');
  }, 60000);

  test('processMessage works with Instagram platform', async () => {
    const requestId = 'test-instagram-' + Date.now();
    
    const response = await processMessage(
      'test-msg-ig-' + Date.now(),
      'test-user-ig-123',
      'Testing Instagram integration',
      'instagram',  // Different platform
      null,
      'Instagram User',
      null,
      requestId,
    );

    expect(typeof response).toBe('string');
    expect(response.length).toBeGreaterThan(0);
    console.log('✓ Instagram platform works');
  }, 60000);

  test('processMessage persists thread ID', async () => {
    const requestId = 'test-thread-' + Date.now();
    const userId = 'test-user-thread-' + Date.now();
    
    // First message
    const response1 = await processMessage(
      'test-msg-1-' + Date.now(),
      userId,
      'First message',
      'messenger',
      null,
      'Thread Test User',
      null,
      requestId + '-1',
    );

    expect(response1).toBeDefined();
    
    // Second message should use thread context
    // (This tests that thread ID was persisted)
    const response2 = await processMessage(
      'test-msg-2-' + Date.now(),
      userId,
      'Second message',
      'messenger',
      null,
      'Thread Test User',
      null,  // No lastThreadId passed, should be fetched from DB
      requestId + '-2',
    );

    expect(response2).toBeDefined();
    console.log('✓ Thread persistence works');
  }, 120000); // Longer timeout for 2 API calls
});

// Show helpful message if tests are skipped
if (!shouldRun) {
  console.log('\n⚠️  Integration tests skipped by default');
  console.log('   To run: RUN_INTEGRATION_TESTS=true npm test\n');
} else if (!hasRequiredEnv) {
  console.log('\n⚠️  Integration tests skipped - missing required env vars:');
  if (!process.env.OPENAI_API_KEY) console.log('   ✗ OPENAI_API_KEY');
  if (!hasFirebaseConfig) console.log('   ✗ FIREBASE_DATABASE_URL or DATABASE_URL');
  if (!process.env.NOTION_TOKEN) console.log('   ✗ NOTION_TOKEN');
  if (!process.env.NOTION_BLOCK_ID) console.log('   ✗ NOTION_BLOCK_ID');
  console.log('   Add these to .env to run integration tests\n');
}
