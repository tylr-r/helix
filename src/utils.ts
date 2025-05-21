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

export const getHumanReadableDate = (): string => {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
  });
};
