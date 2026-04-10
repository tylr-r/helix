/**
 * UTILITY FUNCTION TESTS
 * 
 * Fast unit tests for utility functions
 */

import crypto from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
    filterValidMessages,
    getHumanReadableDate,
    getTimeSince,
    isValidMetaSignature,
    maskIdentifier,
    summarizeText,
} from '../utils';

describe('Utility Functions', () => {
  test('getHumanReadableDate returns valid date string', () => {
    const date = getHumanReadableDate();
    
    expect(date).toBeDefined();
    expect(typeof date).toBe('string');
    expect(date.length).toBeGreaterThan(0);
    
    // Should be a valid date format (contains separators or numbers)
    expect(date).toMatch(/[\d\W]/);
    
    console.log('✓ getHumanReadableDate works:', date);
  });

  test('getTimeSince calculates time correctly', () => {
    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000)); // 1 hour ago
    const result = getTimeSince(oneHourAgo);
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    
    // Should mention "hour" for 1 hour ago
    expect(result.toLowerCase()).toContain('hour');
    
    console.log('✓ getTimeSince calculates correctly:', result);
  });

  test('getTimeSince handles two dates', () => {
    const twoHoursAgo = new Date(Date.now() - (2 * 60 * 60 * 1000));
    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));
    
    const result = getTimeSince(twoHoursAgo, oneHourAgo);
    
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.toLowerCase()).toContain('hour');
    expect(result).toContain('1'); // Should be ~1 hour difference
    
    console.log('✓ getTimeSince handles two dates:', result);
  });

  test('filterValidMessages filters messages', () => {
    // Create mock message thread
    const messages = [
      { from: { id: 'user1' }, message: 'Hello', created_time: '2023-01-01', id: '1' },
      { from: { id: 'user2' }, message: 'Hi', created_time: '2023-01-02', id: '2' },
      { from: { id: 'user1' }, message: 'How are you?', created_time: '2023-01-03', id: '3' },
    ];

    // filterValidMessages only takes one argument (the array)
    const filtered = filterValidMessages(messages);
    
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBeGreaterThan(0);
    
    console.log('✓ filterValidMessages works, filtered count:', filtered.length);
  });

  test('filterValidMessages handles empty input', () => {
    const filtered = filterValidMessages([]);
    
    expect(Array.isArray(filtered)).toBe(true);
    expect(filtered.length).toBe(0);
    
    console.log('✓ filterValidMessages handles empty array');
  });

  test('filterValidMessages removes invalid messages', () => {
    const messages = [
      { message: 'Valid message 1' },
      { message: null }, // Invalid - should be filtered
      { message: 'Valid message 2' },
      { message: undefined }, // Invalid - should be filtered
      { message: 'Valid message 3' },
    ];

    const filtered = filterValidMessages(messages);
    
    // Should filter out null/undefined messages and the ones before them
    expect(filtered.length).toBeLessThan(messages.length);
    
    console.log('✓ filterValidMessages removes invalid messages');
  });

  test('filterValidMessages handles "clear" command', () => {
    const messages = [
      { message: 'Message 1' },
      { message: 'Message 2' },
      { message: 'clear' }, // This should clear history
      { message: 'Message 3' },
      { message: 'Message 4' },
    ];

    const filtered = filterValidMessages(messages);
    
    // After "clear", should only have messages after it
    expect(filtered.length).toBe(2); // Only Message 3 and 4
    
    console.log('✓ filterValidMessages handles clear command');
  });

  test('maskIdentifier redacts most of an identifier', () => {
    expect(maskIdentifier('1234567890')).toBe('12***90');
    expect(maskIdentifier('1234')).toBe('***');
    expect(maskIdentifier(undefined)).toBe('unknown');
  });

  test('summarizeText reports text length without exposing content', () => {
    expect(summarizeText('secret')).toBe('length=6');
    expect(summarizeText('')).toBe('length=0');
    expect(summarizeText(undefined)).toBe('length=0');
  });

  test('isValidMetaSignature validates a correct Meta webhook signature', () => {
    const appSecret = 'top-secret';
    const rawBody = Buffer.from(JSON.stringify({test: true}));
    const signature = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');

    expect(
      isValidMetaSignature(rawBody, `sha256=${signature}`, appSecret),
    ).toBe(true);
    expect(
      isValidMetaSignature(rawBody, 'sha256=deadbeef', appSecret),
    ).toBe(false);
  });
});
