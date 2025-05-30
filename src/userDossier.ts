import * as functions from 'firebase-functions/v2';
import { logLogs, logTime } from './utils';

// Import services
import { UserDossierData, getDossierMapping } from './dossierMappingService';
import {
  getDossierContentFromMapping,
  persistDossierUpdate,
} from './dossierPersistence';

// Types for the dossier system
export interface DossierContent {
  userId: string;
  name?: string;
  personalityInsights: string[];
  conversationSummaries: string[];
  preferences: string[];
  relationships: string[];
  interests: string[];
  goals: string[];
  context: string[];
}

export interface VectorStoreSearchResult {
  content: string;
  score: number;
  fileId: string;
}

// Re-export the UserDossierData type for external consumers
export type { UserDossierData };

/**
 * Generates initial YAML/Markdown content for a new user dossier
 */
const generateInitialDossierContent = (
  userId: string,
  name?: string,
): string => {
  return `---
userId: "${userId}"
name: "${name || 'Unknown'}"
---

## Relationships
<!-- Format: **Name** (relationship type): Description -->

## Preferences
<!-- Format: **[Category Name]**: Short placeholder description (confidence: [level]) -->

## Context & Background
<!-- Format: key: example description -->

## Personality Insights
<!-- Format: Freeform text with bullet points if needed -->

## Conversation Summaries
<!-- Format: Bullet points summarizing key discussion topics -->

## Interests & Hobbies
<!-- Format: Bullet points or a list of topics/activities -->

## Goals & Aspirations
<!-- Format: Bullet points outlining personal or professional objectives -->`;
};

/**
 * Creates a new user dossier file and adds it to the vector store.
 * Note: This is now internal-only, use ensureUserDossier for external calls.
 *
 * @param userId - The unique identifier for the user.
 * @param name - Optional name of the user to include in the dossier.
 * @param content - Optional content to initialize the dossier file. If not provided,
 *                  default content will be generated using `generateInitialDossierContent`.
 * @param requestId - Optional request identifier for logging and tracking purposes.
 * @returns A promise that resolves to a boolean indicating success or failure.
 */
const createUserDossier = async (
  userId: string,
  requestId: string,
  name?: string,
  content?: string, // Optional content parameter
): Promise<boolean> => {
  const start = Date.now();

  logLogs(
    `DOSSIER: Attempting to create dossier for user ${userId}`,
    requestId,
  );

  // Check if dossier already exists
  const existingMapping = await getDossierMapping(userId, requestId);
  if (existingMapping) {
    logLogs(
      `DOSSIER: Dossier already exists for user ${userId} (File ID: ${existingMapping.fileId}). No action needed.`,
      requestId,
    );
    return true;
  }

  logLogs(`DOSSIER: Creating new dossier for user ${userId}`, requestId);
  // Use provided content or generate initial content
  const dossierFileContent =
    content ?? generateInitialDossierContent(userId, name);

  // Persist the new dossier file and its mapping
  const persistResult = await persistDossierUpdate(
    userId,
    dossierFileContent, // Use the determined content
    null, // No existing mapping, so it's a new creation
    requestId,
  );

  if (persistResult) {
    logTime(start, 'createUserDossier_success', requestId);
    return true;
  } else {
    logLogs(
      `DOSSIER: Failed to persist new dossier for user ${userId}`,
      requestId,
    );
    return false;
  }
};

// updateUserDossier removed - was unused and duplicated functionality with updateDossierSection

/**
 * Updates a specific section of the dossier with organized content
 * Note: This is now internal-only, called via handleDossierFunctionCall
 */
const updateDossierSection = async (
  userId: string,
  requestId: string,
  section:
    | 'relationships'
    | 'preferences'
    | 'context'
    | 'insights'
    | 'summaries'
    | 'interests'
    | 'goals',
  contentToAdd: string, // Renamed for clarity
): Promise<boolean> => {
  const start = Date.now();

  logLogs(`DOSSIER: Updating ${section} section for user ${userId}`, requestId);

  const mapping = await getDossierMapping(userId, requestId);
  if (!mapping) {
    logLogs(
      `DOSSIER: No existing dossier for ${userId} in updateDossierSection. Creating new one.`,
      requestId,
    );
    // If no dossier, create one and add this section.
    const initialContent = generateInitialDossierContent(userId, undefined); // Name might be unknown
    const sectionInfo = sectionMap[section]; // sectionMap needs to be accessible or passed
    if (!sectionInfo) {
      functions.logger.error(
        `DOSSIER: Unknown section ${section} during initial creation.`,
        requestId,
      );
      return false;
    }
    const newDossierContent =
      initialContent + `\n\n${sectionInfo.header}\n${contentToAdd}\n`;
    return await createUserDossier(
      // Changed to use the modified createUserDossier
      userId,
      requestId,
      undefined, // name
      newDossierContent, // Pass the content here
    );
  }

  let existingContent = '';
  const fileContent = await getDossierContentFromMapping(mapping, requestId);
  if (fileContent) {
    existingContent = fileContent;
  } else {
    functions.logger.warn(
      `DOSSIER: Could not retrieve existing file content for ${mapping.fileId} in updateDossierSection. Content will be reconstructed.`,
      requestId,
    );
    // If content retrieval fails, reconstruct with frontmatter and the new section.
    existingContent = generateInitialDossierContent(userId, undefined); // Assuming name might not be in mapping or easily retrievable here
  }

  const sectionInfo = sectionMap[section]; // Ensure sectionMap is defined in this scope or passed
  if (!sectionInfo) {
    functions.logger.error(`DOSSIER: Unknown section: ${section}`, requestId);
    return false;
  }

  const lines = existingContent.split('\n');
  let sectionStartIndex = -1;
  let sectionEndIndex = -1;
  let finalContentString: string;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === sectionInfo.header) {
      sectionStartIndex = i;
      break;
    }
  }

  if (sectionStartIndex === -1) {
    // Section doesn't exist, add it (ensuring frontmatter is preserved if existingContent was just frontmatter)
    logLogs(
      `DOSSIER: Section ${section} not found for ${userId}, creating new section.`,
      requestId,
    );
    const newSectionBlock = [
      '', // Ensure a blank line before new section if file is not empty
      sectionInfo.header,
      sectionInfo.comment,
      '',
      contentToAdd,
      '',
    ].join('\n');
    finalContentString =
      existingContent.trim() ===
      generateInitialDossierContent(userId, undefined).trim()
        ? existingContent + newSectionBlock // If only frontmatter, append
        : lines.join('\n') + newSectionBlock; // Append to existing content
  } else {
    // Section exists, find its end and update content
    for (let i = sectionStartIndex + 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('## ') || lines[i].trim() === '---') {
        sectionEndIndex = i;
        break;
      }
    }
    if (sectionEndIndex === -1) {
      sectionEndIndex = lines.length;
    }

    const existingSectionLines: string[] = [];
    for (let i = sectionStartIndex + 1; i < sectionEndIndex; i++) {
      const line = lines[i].trim();
      if (
        line &&
        !line.startsWith('<!--') &&
        !line.startsWith('-->') &&
        !line.includes('Examples:')
      ) {
        existingSectionLines.push(lines[i]);
      }
    }

    const updatedSectionLines = [sectionInfo.header];
    if (sectionInfo.comment) updatedSectionLines.push(sectionInfo.comment);
    updatedSectionLines.push(...existingSectionLines, contentToAdd, '');

    const beforeSection = lines.slice(0, sectionStartIndex).join('\n');
    const afterSection = lines.slice(sectionEndIndex).join('\n');
    finalContentString =
      beforeSection +
      (beforeSection ? '\n' : '') +
      updatedSectionLines.join('\n') +
      (afterSection ? '\n' : '') +
      afterSection;
  }

  const persistResult = await persistDossierUpdate(
    userId,
    finalContentString,
    mapping,
    requestId,
  );

  if (persistResult) {
    logTime(start, 'updateDossierSection_success', requestId);
    return true;
  } else {
    logLogs(
      `DOSSIER: Failed to persist updated dossier section for user ${userId}`,
      requestId,
    );
    return false;
  }
};

// Ensure sectionMap is defined in a scope accessible by updateDossierSection
// This might need to be at the top level of the module or passed around.
// For this refactor, I'll assume it's defined at the module level.
const sectionMap = {
  relationships: {
    header: '## Relationships',
    comment: '<!-- Format: **Name** (relationship type): Description -->',
  },
  preferences: {
    header: '## Preferences',
    comment:
      '<!-- Format: **[Category Name]**: Short placeholder description (confidence: [level]) -->',
  },
  context: {
    header: '## Context & Background',
    comment: '<!-- Format: key: example description -->',
  },
  insights: {
    header: '## Personality Insights',
    comment: '<!-- Format: Freeform text with bullet points if needed -->',
  },
  summaries: {
    header: '## Conversation Summaries',
    comment: '<!-- Format: Bullet points summarizing key discussion topics -->',
  },
  interests: {
    header: '## Interests & Hobbies',
    comment: '<!-- Format: Bullet points or a list of topics/activities -->',
  },
  goals: {
    header: '## Goals & Aspirations',
    comment:
      '<!-- Format: Bullet points outlining personal or professional objectives -->',
  },
};

/**
 * Helper function to get or create a dossier for a user
 */
export const ensureUserDossier = async (
  userId: string,
  requestId: string,
  name?: string,
): Promise<boolean> => {
  const mapping = await getDossierMapping(userId, requestId);
  if (mapping) {
    logLogs(`DOSSIER: Dossier already exists for user ${userId}`, requestId);
    return true;
  }
  logLogs(`DOSSIER: Creating new dossier for user ${userId}`, requestId);
  return await createUserDossier(userId, requestId, name);
};

// Helper functions consolidated into handleDossierFunctionCall - removed to reduce bloat

// OpenAI Function Call Definitions for Intelligent Dossier Updates
export const dossierFunctionTools = [
  {
    type: 'function' as const,
    name: 'update_user_relationship',
    function: {
      name: 'update_user_relationship',
      description:
        'Update information about a person mentioned in conversation',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the person mentioned',
          },
          relationship: {
            type: 'string',
            description:
              "Their relationship to the user (e.g., 'mother', 'colleague', 'friend', 'boss', 'sister', 'partner')",
          },
          context: {
            type: 'string',
            description:
              'Additional context about this person or the relationship',
          },
        },
        required: ['name', 'relationship'],
      },
    },
  },
  {
    type: 'function' as const,
    name: 'update_user_preferences',
    function: {
      name: 'update_user_preferences',
      description:
        "Update user's preferences, interests, or personality traits",
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: [
              'food',
              'hobbies',
              'work',
              'lifestyle',
              'personality',
              'communication_style',
              'interests',
              'goals',
            ],
            description: 'Category of the preference or trait',
          },
          insight: {
            type: 'string',
            description: 'The specific preference, interest, or trait observed',
          },
          confidence: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description:
              'How confident you are about this insight based on the conversation',
          },
        },
        required: ['category', 'insight'],
      },
    },
  },
  {
    type: 'function' as const,
    name: 'update_user_context',
    function: {
      name: 'update_user_context',
      description:
        'Record your personal reflections and feelings about the conversation like a diary entry. Focus on the mood, emotional tone, and your subjective experience of the interaction rather than literal transcripts.',
      parameters: {
        type: 'object',
        properties: {
          context: {
            type: 'string',
            description:
              'Your diary-like reflection on the conversation - how it felt, the mood, your emotional response, interesting dynamics, or meaningful moments. Write as if reflecting on the interaction personally.',
          },
          timeframe: {
            type: 'string',
            enum: ['current', 'recent', 'ongoing', 'past'],
            description: 'When this context applies',
          },
        },
        required: ['context'],
      },
    },
  },
];

/**
 * Handles OpenAI function calls for intelligent dossier updates
 * This replaces the simple keyword-based approach with AI-driven analysis
 */
export async function handleDossierFunctionCall(
  userId: string,
  functionName: string,
  functionArgs: any,
  requestId: string,
): Promise<void> {
  try {
    switch (functionName) {
      case 'update_user_relationship': {
        // Inline relationship insight logic (formerly addRelationshipInsight)
        const relationshipText = functionArgs.context
          ? `- **${functionArgs.name}** (${functionArgs.relationship}): ${functionArgs.context}`
          : `- **${functionArgs.name}** (${functionArgs.relationship})`;

        await updateDossierSection(
          userId,
          requestId,
          'relationships',
          relationshipText,
        );

        logLogs(
          `DOSSIER: Updated relationship: ${functionArgs.name} (${functionArgs.relationship})`,
          requestId,
        );
        break;
      }

      case 'update_user_preferences': {
        let preferenceInsight = `${functionArgs.insight}`;
        if (functionArgs.confidence) {
          preferenceInsight += ` (confidence: ${functionArgs.confidence})`;
        }
        if (functionArgs.category) {
          preferenceInsight = `[${functionArgs.category}] ${preferenceInsight}`;
        }

        // Determine which section to update based on category
        let section: 'preferences' | 'interests' | 'goals' = 'preferences';
        if (
          functionArgs.category === 'interests' ||
          functionArgs.category === 'hobbies'
        ) {
          section = 'interests';
        } else if (functionArgs.category === 'goals') {
          section = 'goals';
        }

        await updateDossierSection(
          userId,
          requestId,
          section,
          `- ${preferenceInsight}`,
        );

        logLogs(
          `DOSSIER: Updated ${section}: ${functionArgs.category} - ${functionArgs.insight}`,
          requestId,
        );
        break;
      }

      case 'update_user_context': {
        const contextInsight = `${functionArgs.timeframe || 'recent'}: ${
          functionArgs.context
        }`;
        await updateDossierSection(
          userId,
          requestId,
          'context',
          `- ${contextInsight}`,
        );
        logLogs(`DOSSIER: Updated context: ${functionArgs.context}`, requestId);
        break;
      }

      default:
        functions.logger.warn(
          `DOSSIER: Unknown dossier function: ${functionName}`,
        );
    }
  } catch (error) {
    functions.logger.error(
      `DOSSIER: Error handling dossier function call: ${error}`,
    );
  }
}

/**
 * Retrieves and displays the full dossier content for debugging
 * Note: Keep exported for debugging purposes, but could be removed in production
 */
export const inspectDossier = async (
  userId: string,
  requestId: string,
): Promise<string | null> => {
  try {
    const mapping = await getDossierMapping(userId, requestId);
    if (!mapping) {
      console.log(`No dossier found for user ${userId}`);
      return null;
    }

    const content = await getDossierContentFromMapping(mapping, requestId);
    if (!content) {
      console.log(`Failed to retrieve content for user ${userId}`);
      return null;
    }

    logLogs(`DOSSIER: Retrieved full content for user ${userId}`, requestId);

    return content;
  } catch (error) {
    functions.logger.error(
      `Failed to inspect dossier for user ${userId}: ${error}`,
    );
    return null;
  }
};
