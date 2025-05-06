import * as functions from 'firebase-functions/v2';
import { PlatformType, getUserName } from './facebook';
import { database } from './firebase'; // Import database from centralized Firebase module
import { getHumanReadableDate, logLogs, logTime } from './utils';

/**
 * Creates a new user or updates an existing user in the database
 */
export const storeNewUser = async (
  userId: string,
  userName: string,
  platform: PlatformType,
  update = false,
) => {
  const humanReadableDate = getHumanReadableDate();
  try {
    if (update) {
      logLogs('Updating user info');
      database.ref(`users/${userId}`).update({
        created_at: humanReadableDate,
        userName,
        platform,
      });
    }
    logLogs('Creating new user info');
    database.ref(`users/${userId}`).set({
      created_at: humanReadableDate,
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
) => {
  logLogs('Storing latest thread id in Database');
  const lastUpdated = getHumanReadableDate();
  const id = thread;
  logLogs(`userName: ${userName}`);
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
): Promise<{ thread: { id: string | null }; userName: string }> => {
  const start = Date.now();
  logLogs(`Getting stored info for user ${userId} on ${platform}`);
  try {
    const userInfo = (
      await database.ref(`users/${userId}`).once('value')
    ).val();

    let userName: string;
    let threadId: string | null = null;

    if (!userInfo) {
      logLogs(`No user found for ${userId}, creating new user.`);
      userName = (await getUserName(userId, platform)) ?? 'someone';
      await storeNewUser(userId, userName, platform, false);
      logTime(start, `getStoredInfo (New User) for ${userId}`);
      // New user won't have a thread ID yet
      return { thread: { id: null }, userName };
    }

    userName = userInfo.userName;
    threadId = userInfo.thread?.id ?? null;

    if (!userName) {
      logLogs(`No username found for user ${userId}. Fetching and updating.`);
      userName = (await getUserName(userId, platform)) ?? 'someone';
      await storeNewUser(userId, userName, platform, true);
    }

    if (!threadId) {
      logLogs(`No thread ID found for user ${userId}.`);
      logTime(start, `getStoredInfo (No Thread) for ${userId}`);
      return { thread: { id: null }, userName };
    }

    logTime(start, `getStoredInfo (Existing User) for ${userId}`);
    return { thread: { id: threadId }, userName };
  } catch (error) {
    functions.logger.error(
      `Error getting stored info for user ${userId}: ${error}`,
    );
    logTime(start, `getStoredInfo (Error) for ${userId}`);
    const fallbackUserName = (await getUserName(userId, platform)) ?? 'someone';
    return { thread: { id: null }, userName: fallbackUserName };
  }
};

/**
 * Updates or creates a personality entry for a user
 */
export const updatePersonality = async (
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
