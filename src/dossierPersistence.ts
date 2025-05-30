import * as functions from 'firebase-functions';
import OpenAI from 'openai';
import { UserDossierData, storeDossierMapping } from './dossierMappingService';
import { database } from './firebase';
import { logLogs } from './utils';

// OpenAI client configuration
const openaitoken = process.env.OPENAI_API_KEY ?? '';
const openAiOrgId = process.env.OPENAI_ORG_ID;
const vectorStoreId = process.env.VECTOR_STORE_ID ?? '';

const openai = new OpenAI({
  organization: openAiOrgId,
  apiKey: openaitoken,
});

/**
 * Result type for dossier persistence operations
 */
export interface DossierPersistenceResult {
  newFileId: string;
  newVectorStoreFileId?: string;
}

/**
 * Private helper function to manage the lifecycle of a dossier file
 */
export async function persistDossierUpdate(
  userId: string,
  newContent: string,
  existingMapping: UserDossierData | null,
  requestId: string,
): Promise<DossierPersistenceResult | null> {
  try {
    // 1. Create the new OpenAI file
    const newOpenAiFile = await openai.files.create({
      file: new File([newContent], `dossier-${userId}-${Date.now()}.md`, {
        type: 'text/markdown',
      }),
      purpose: 'assistants',
    });
    logLogs(
      `DOSSIER: Created new OpenAI file ${newOpenAiFile.id} for user ${userId}`,
      requestId,
    );

    let newVectorStoreFileId: string | undefined;

    // 2. Update Vector Store (if configured)
    if (vectorStoreId) {
      // 2a. Delete old file from vector store (if it exists)
      if (existingMapping?.vectorStoreFileId) {
        try {
          await openai.vectorStores.files.del(
            vectorStoreId,
            existingMapping.vectorStoreFileId,
          );
          logLogs(
            `DOSSIER: Removed old file ${existingMapping.vectorStoreFileId} from vector store`,
            requestId,
          );
        } catch (removeError) {
          functions.logger.warn(
            `DOSSIER: Failed to remove old file from vector store: ${removeError}`,
            requestId,
          );
        }
      }
      // 2b. Add new file to vector store
      try {
        const vectorStoreFile = await openai.vectorStores.files.create(
          vectorStoreId,
          {
            file_id: newOpenAiFile.id,
          },
        );
        newVectorStoreFileId = vectorStoreFile.id;
        logLogs(
          `DOSSIER: Added new file ${newOpenAiFile.id} to vector store as ${newVectorStoreFileId}`,
          requestId,
        );
      } catch (vectorError) {
        functions.logger.warn(
          `DOSSIER: Failed to add new file to vector store: ${vectorError}`,
          requestId,
        );
      }
    }

    // 3. Delete old OpenAI file (if it exists)
    if (existingMapping?.fileId) {
      try {
        await openai.files.del(existingMapping.fileId);
        logLogs(
          `DOSSIER: Deleted old OpenAI file ${existingMapping.fileId}`,
          requestId,
        );
      } catch (deleteError) {
        functions.logger.warn(
          `DOSSIER: Failed to delete old OpenAI file: ${deleteError}`,
          requestId,
        );
      }
    }

    // 4. Store/Update mapping in Firebase
    if (newVectorStoreFileId) {
      await storeDossierMapping(
        userId,
        newOpenAiFile.id,
        requestId,
        newVectorStoreFileId,
        !existingMapping,
        newContent,
      );
    } else {
      await storeDossierMapping(
        userId,
        newOpenAiFile.id,
        requestId,
        undefined,
        !existingMapping,
        newContent,
      );
    }

    return { newFileId: newOpenAiFile.id, newVectorStoreFileId };
  } catch (error) {
    functions.logger.error(
      `DOSSIER: Failed during dossier file persistence for user ${userId}: ${error}`,
      requestId,
    );
    return null;
  }
}

/**
 * Retrieves the content of a dossier file from Firebase Database
 * (Since OpenAI doesn't allow downloading files with "assistants" purpose)
 */
export async function getDossierFileContent(
  fileId: string,
  requestId: string,
): Promise<string | null> {
  try {
    logLogs(
      `DOSSIER: Retrieving file content for ${fileId} from Firebase`,
      requestId,
    );

    const usersSnapshot = await database.ref('users').once('value');
    const users = usersSnapshot.val();

    if (!users) {
      functions.logger.warn(
        `DOSSIER: No users found when searching for fileId ${fileId}`,
        requestId,
      );
      return null;
    }

    for (const userId in users) {
      const userData = users[userId];
      if (userData.dossier?.fileId === fileId && userData.dossier?.content) {
        logLogs(
          `DOSSIER: Retrieved file content for ${fileId} from Firebase`,
          requestId,
        );
        return userData.dossier.content;
      }
    }

    functions.logger.warn(
      `DOSSIER: Could not find content for fileId ${fileId} in Firebase`,
      requestId,
    );
    return null;
  } catch (error) {
    functions.logger.warn(
      `DOSSIER: Could not retrieve file content for ${fileId} from Firebase: ${error}`,
      requestId,
    );
    return null;
  }
}

/**
 * Retrieves the content of a dossier from a UserDossierData object
 */
export async function getDossierContentFromMapping(
  mapping: UserDossierData,
  requestId: string,
): Promise<string | null> {
  if (mapping.content) {
    logLogs(
      `DOSSIER: Retrieved content from mapping for user ${mapping.userId}`,
      requestId,
    );
    return mapping.content;
  }

  logLogs(
    `DOSSIER: No content in mapping for user ${mapping.userId}, falling back to fileId search`,
    requestId,
  );
  return getDossierFileContent(mapping.fileId, requestId);
}

/**
 * Performs semantic search in the vector store
 */
export async function searchVectorStore(
  query: string,
  maxResults = 5,
  requestId: string,
): Promise<string[]> {
  if (!vectorStoreId) {
    functions.logger.warn(
      'Vector store ID not configured for search',
      requestId,
    );
    return [];
  }

  try {
    logLogs(
      `DOSSIER: Performing vector store search for query: "${query}"`,
      requestId,
    );

    const searchResponse = await openai.vectorStores.search(vectorStoreId, {
      query,
      max_num_results: maxResults,
    });

    const insights: string[] = [];
    for (const result of searchResponse.data) {
      for (const content of result.content) {
        if (content.type === 'text' && content.text) {
          insights.push(content.text);
        }
      }
    }

    logLogs(
      `DOSSIER: Vector store search returned ${insights.length} results`,
      requestId,
    );

    return insights;
  } catch (error) {
    functions.logger.warn(
      `DOSSIER: Vector store search failed: ${error}`,
      requestId,
    );
    return [];
  }
}
