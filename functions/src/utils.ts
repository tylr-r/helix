import * as functions from 'firebase-functions';

// Store all logs
export const logs: string[] = [];
export const timeLogs: string[] = [];

// Log to Firebase and store in logs array
export const logLogs = (log: string) => {
  functions.logger.log(log);
  logs.push(log);
};

// Log time elapsed for operations
export const logTime = async (start: number, label: string) => {
  const end = Date.now();
  const log = `${end - start}ms for ${label}`;
  functions.logger.log(log);
  timeLogs.push(log);
};

export const getHumanReadableDate = (): string => {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
  });
};
