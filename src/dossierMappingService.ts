import * as functions from 'firebase-functions';
import { database } from './firebase';
import { logLogs } from './utils';

export interface UserDossierData {
  userId: string;
  fileId: string;
  vectorStoreFileId?: string;
  content?: string;
}

/**
 * Stores dossier file mapping in Firebase Database
 */
export const storeDossierMapping = async (
  userId: string,
  fileId: string,
  requestId: string,
  vectorStoreFileId?: string,
  isNewDossier?: boolean,
  content?: string,
): Promise<void> => {
  try {
    const dossierDataRef = database.ref(`users/${userId}/dossier`);
    const dossierData: UserDossierData = {
      userId,
      fileId,
      vectorStoreFileId,
      content,
    };

    await dossierDataRef.set(dossierData);

    logLogs(
      `DOSSIER: ${
        isNewDossier ? 'Stored new' : 'Updated'
      } dossier mapping for user ${userId}${content ? ' with content' : ''}`,
      requestId,
    );
  } catch (error) {
    functions.logger.error(
      `Error storing dossier mapping for user ${userId}: ${error}`,
    );
    throw error;
  }
};

/**
 * Retrieves dossier file mapping from Firebase Database
 */
export const getDossierMapping = async (
  userId: string,
  requestId: string,
): Promise<UserDossierData | null> => {
  try {
    const snapshot = await database
      .ref(`users/${userId}/dossier`)
      .once('value');
    const data = snapshot.val() as UserDossierData | null;

    logLogs(
      `DOSSIER: Retrieved dossier mapping for user ${userId}: ${
        data ? 'found' : 'not found'
      }`,
      requestId,
    );

    return data;
  } catch (error) {
    functions.logger.error(
      `DOSSIER: Error retrieving dossier mapping for user ${userId}: ${error}`,
    );
    return null;
  }
};
