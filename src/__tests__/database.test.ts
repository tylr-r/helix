/**
 * DATABASE TESTS
 * 
 * Tests Firebase database operations
 * 
 * To run: RUN_INTEGRATION_TESTS=true npm test
 * 
 * Note: These tests are completely skipped if Firebase is not configured
 */

import { beforeAll, describe, expect, test } from 'vitest';

const shouldRun = process.env.RUN_INTEGRATION_TESTS === 'true';

const hasFirebaseConfig = Boolean(
  process.env.FIREBASE_DATABASE_URL || 
  process.env.DATABASE_URL
);

// Only import database functions if we're actually going to run tests
// This prevents Firebase initialization errors when just running quick tests
let updateLastThreadId: any;
let getStoredInfo: any;
let storeNewUser: any;
let updatePersonalityInDB: any;
let getPersonality: any;

if (shouldRun && hasFirebaseConfig) {
  const db = await import('../database');
  updateLastThreadId = db.updateLastThreadId;
  getStoredInfo = db.getStoredInfo;
  storeNewUser = db.storeNewUser;
  updatePersonalityInDB = db.updatePersonalityInDB;
  getPersonality = db.getPersonality;
}

describe.skipIf(!shouldRun || !hasFirebaseConfig)('Database Operations', () => {
  const testUserId = 'test-user-db-' + Date.now();
  const testRequestId = 'test-req-' + Date.now();

  beforeAll(() => {
    console.log('\n🔧 Database Test Setup:');
    console.log('  Firebase configured:', hasFirebaseConfig ? '✓' : '✗');
    console.log('  Test user ID:', testUserId);
    console.log('');
  });

  test('storeNewUser creates new user', async () => {
    const userName = 'Test User';
    
    await storeNewUser(
      testUserId,
      userName,
      'messenger',
      false,
      testRequestId,
    );

    // Verify by retrieving
    const info = await getStoredInfo(testUserId, 'messenger', testRequestId);
    expect(info.userName).toBe(userName);
    
    console.log('✓ New user created successfully');
  }, 30000);

  test('updateLastThreadId stores thread ID', async () => {
    const threadId = 'thread-' + Date.now();
    const userName = 'Thread Test User';

    await updateLastThreadId(
      testUserId,
      threadId,
      userName,
      testRequestId,
    );

    // Verify it was stored by retrieving it
    const info = await getStoredInfo(testUserId, 'messenger', testRequestId);
    expect(info.thread.id).toBe(threadId);
    
    console.log('✓ Thread ID stored and retrieved successfully');
  }, 30000);

  test('getStoredInfo returns null thread for new user', async () => {
    const newUserId = 'test-user-new-' + Date.now();
    
    const info = await getStoredInfo(newUserId, 'messenger', testRequestId);
    expect(info.thread.id).toBeNull();
    expect(info.userName).toBeDefined();
    
    console.log('✓ Returns null thread for new user');
  }, 30000);

  test('updateLastThreadId updates existing user', async () => {
    const threadId1 = 'thread-1-' + Date.now();
    const threadId2 = 'thread-2-' + Date.now();
    const userName = 'Update Test User';

    // Store first thread ID
    await updateLastThreadId(testUserId, threadId1, userName, testRequestId);
    
    // Update with new thread ID
    await updateLastThreadId(testUserId, threadId2, userName, testRequestId);
    
    // Should get the most recent one
    const info = await getStoredInfo(testUserId, 'messenger', testRequestId);
    expect(info.thread.id).toBe(threadId2);
    
    console.log('✓ Thread ID updates correctly');
  }, 30000);

  test('updatePersonalityInDB stores personality data', async () => {
    const personalityData = JSON.stringify({
      traits: ['helpful', 'friendly'],
      preferences: { style: 'casual' },
    });

    const result = await updatePersonalityInDB(testUserId, personalityData);
    expect(result).toBe(true);
    
    console.log('✓ Personality data stored');
  }, 30000);

  test('getPersonality retrieves personality data', async () => {
    const personalityData = JSON.stringify({
      traits: ['test trait'],
      timestamp: Date.now(),
    });

    // Store it first
    await updatePersonalityInDB(testUserId, personalityData);
    
    // Retrieve it
    const retrieved = await getPersonality(testUserId);
    expect(retrieved).toBeDefined();
    expect(retrieved.personality).toBe(personalityData);
    
    console.log('✓ Personality data retrieved');
  }, 30000);

  test('getPersonality returns null for user without personality', async () => {
    const newUserId = 'test-user-no-personality-' + Date.now();
    
    const personality = await getPersonality(newUserId);
    expect(personality).toBeNull();
    
    console.log('✓ Returns null when no personality exists');
  }, 30000);
});

if (!shouldRun) {
  console.log('\n⚠️  Database tests skipped by default');
  console.log('   To run: RUN_INTEGRATION_TESTS=true npm test\n');
} else if (!hasFirebaseConfig) {
  console.log('\n⚠️  Database tests skipped - Firebase not configured');
  console.log('   Add FIREBASE_DATABASE_URL to .env\n');
}
