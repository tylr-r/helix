import * as functions from 'firebase-functions';

export const logs: string[] = [];

export const timeLogsMap: Map<string, string[]> = new Map();

export const logsMap: Map<string, string[]> = new Map();

export const logLogs = (log: string, requestId: string) => {
  functions.logger.log(log);
  let logsArr = logsMap.get(requestId);
  if (!logsArr) {
    logsArr = [];
    logsMap.set(requestId, logsArr);
  }
  logsArr.push(log);
};

export const logTime = async (
  start: number,
  label: string,
  requestId: string,
) => {
  const end = Date.now();
  const log = `${end - start}ms for ${label}`;
  functions.logger.log(log);
  let logsArr = timeLogsMap.get(requestId);
  if (!logsArr) {
    logsArr = [];
    timeLogsMap.set(requestId, logsArr);
  }
  logsArr.push(log);
};

export const getLogs = (requestId: string): string[] => {
  return logsMap.get(requestId) || [];
};

export const clearLogs = (requestId: string): void => {
  logsMap.delete(requestId);
};

export const getTimeLogs = (requestId: string): string[] => {
  return timeLogsMap.get(requestId) || [];
};

export const clearTimeLogs = (requestId: string): void => {
  timeLogsMap.delete(requestId);
};

/**
 * @module utils
 * Returns the current date and time as a human-readable string formatted
 * according to the 'en-US' locale and the 'America/Los_Angeles' time zone.
 * @returns {string} like '6/8/2024, 3:45:12 PM'
 */
export const getHumanReadableDate = (): string => {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
  });
};

/**
 * Returns a human-readable string for the time difference between two dates.
 * @param fromDate - The earlier date (e.g., message time)
 * @param toDate - The later date (e.g., now)
 * @returns string like '5 minutes', '2 hours', etc.
 */
export function getTimeSince(
  fromDate: Date,
  toDate: Date = new Date(),
): string {
  const diffMs = toDate.getTime() - fromDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  logLogs(
    `fromDate: ${fromDate.toISOString()}, toDate: ${toDate.toISOString()}, Time difference: ${diffMs}ms (${diffMins} minutes)`,
    'requestId',
  );
  if (diffMins < 0) return 'in the future';
  if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'}`;
  }
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;
  }
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'}`;
}

/**
 * Utility to filter out empty or error messages from a message thread.
 * Excludes messages that are empty, whitespace, or match the default error string.
 * @param msg - The message object with a 'message' property
 * @returns boolean - true if the message should be included
 */
export function isValidMessage(msg: { message: any }): boolean {
  return (
    typeof msg.message === 'string' &&
    msg.message.trim() !== '' &&
    !msg.message.toLowerCase().includes('Sorry, I am having troubles lol')
  );
}

/**
 * Filters out invalid messages and the messages that come directly before them.
 * Also clears history when a "clear" message is encountered.
 * @param messages - Array of message objects
 * @returns Array of filtered messages
 */
export function filterValidMessages<T extends { message: any }>(
  messages: T[],
): T[] {
  const result: T[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // If message is a "clear" command, reset the result list
    if (
      typeof msg.message === 'string' &&
      msg.message.trim().toLowerCase() === 'clear'
    ) {
      result.length = 0;
      continue;
    }

    // If message is invalid, remove the previous message (if any) and skip this one
    if (!isValidMessage(msg)) {
      result.pop(); // Remove last valid message (acts as "the message before")
      continue;
    }

    // Otherwise, message is valid, add to result
    result.push(msg);
  }

  return result;
}
