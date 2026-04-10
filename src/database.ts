import * as functions from 'firebase-functions/v2';
import { PlatformType, getUserName } from './facebook';
import { database } from './firebase';
import { getHumanReadableDate, logLogs, logTime } from './utils';

/**
 * Creates a new user or updates an existing user in the database
 */
export const storeNewUser = async (
  userId: string,
  userName: string,
  platform: PlatformType,
  update = false,
  requestId: string,
) => {
  try {
    if (update) {
      logLogs('Updating user info', requestId);
      database.ref(`users/${userId}`).update({
        userName,
        platform,
      });
    }
    logLogs('Creating new user info', requestId);
    database.ref(`users/${userId}`).set({
      userName,
      platform,
    });
  } catch (error) {
    functions.logger.error(`Error storing new user: ${error}`);
  }
};

/**
 * Updates the last thread ID for a user in the database
 */
export const updateLastThreadId = async (
  userId: string,
  thread: string | null,
  userName: string,
  requestId: string,
) => {
  logLogs('Storing latest thread id in Database', requestId);
  const lastUpdated = getHumanReadableDate();
  const id = thread;
  logLogs(`userName: ${userName}`, requestId);
  try {
    database.ref(`users/${userId}/thread`).set({
      id,
      lastUpdated,
    });
  } catch (error) {
    functions.logger.error(`Error updating thread id: ${error}`);
  }
};

/**
 * Retrieves stored user information (thread ID and username) from the database
 */
export const getStoredInfo = async (
  userId: string,
  platform: PlatformType,
  requestId: string,
): Promise<{ thread: { id: string | null }; userName: string }> => {
  const start = Date.now();
  logLogs(`Getting stored info for user ${userId} on ${platform}`, requestId);
  try {
    const userInfo = (
      await database.ref(`users/${userId}`).once('value')
    ).val();

    let userName: string;
    let threadId: string | null = null;

    if (!userInfo) {
      logLogs(`No user found for ${userId}, creating new user.`, requestId);
      userName = (await getUserName(userId, platform, requestId)) ?? 'someone';
      await storeNewUser(userId, userName, platform, false, requestId);
      logTime(start, `getStoredInfo (New User) for ${userId}`, requestId);
      // New user won't have a thread ID yet
      return { thread: { id: null }, userName };
    }

    userName = userInfo.userName;
    threadId = userInfo.thread?.id ?? null;

    if (!userName) {
      logLogs(
        `No username found for user ${userId}. Fetching and updating.`,
        requestId,
      );
      userName = (await getUserName(userId, platform, requestId)) ?? 'someone';
      await storeNewUser(userId, userName, platform, true, requestId);
    }

    if (!threadId) {
      logLogs(`No thread ID found for user ${userId}.`, requestId);
      logTime(start, `getStoredInfo (No Thread) for ${userId}`, requestId);
      return { thread: { id: null }, userName };
    }

    logTime(start, `getStoredInfo (Existing User) for ${userId}`, requestId);
    return { thread: { id: threadId }, userName };
  } catch (error) {
    functions.logger.error(
      `Error getting stored info for user ${userId}: ${error}`,
    );
    logTime(start, `getStoredInfo (Error) for ${userId}`, requestId);
    const fallbackUserName =
      (await getUserName(userId, platform, requestId)) ?? 'someone';
    return { thread: { id: null }, userName: fallbackUserName };
  }
};

/**
 * Updates or creates a personality entry for a user
 */
export const updatePersonalityInDB = async (
  userId: string,
  personalityData: string,
) => {
  try {
    await database
      .ref(`users/${userId}/personality`)
      .set({ personality: personalityData });
    return true;
  } catch (error) {
    functions.logger.error(`Error updating personality data: ${error}`);
    return false;
  }
};

/**
 * Gets the personality data for a user
 */
export const getPersonality = async (userId: string) => {
  try {
    const userDB = await database
      .ref(`users/${userId}/personality`)
      .once('value');
    return userDB.val();
  } catch (error) {
    functions.logger.error(`Error getting personality data: ${error}`);
    return null;
  }
};
