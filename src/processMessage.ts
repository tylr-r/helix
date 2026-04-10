import * as functions from 'firebase-functions/v2';
import { updateLastThreadId } from './database';
import { getPreviousMessages, MessageThread, PlatformType } from './facebook';
import { extractFileSearchResults, openAiResponsesRequest } from './openai';
import {
  dossierFunctionTools,
  ensureUserDossier,
  handleDossierFunctionCall,
} from './userDossier';
import {
  filterValidMessages,
  getHumanReadableDate,
  getTimeSince,
  logLogs,
  logTime,
} from './utils';

const notionToken = process.env.NOTION_TOKEN;
const notionBlockId = process.env.NOTION_BLOCK_ID;

type Primer = {
  system: { role: string; content: string };
  developer: { role: string; content: string };
};

export const getPrimer = async (requestId: string): Promise<Primer> => {
  const start = Date.now();
  try {
    const response = await fetch(
      `https://api.notion.com/v1/blocks/${notionBlockId}`,
      {
        method: 'GET',
        headers: {
          'Notion-Version': '2022-02-22',
          Authorization: `Bearer ${notionToken}`,
        },
      },
    );

    const data = await response.json();
    const primerText = data.code.rich_text[0].plain_text;
    const parsedPrimer: Primer = JSON.parse(primerText);
    logTime(start, 'getPrimer', requestId);
    return parsedPrimer;
  } catch (error) {
    const errorType =
      error instanceof SyntaxError ? 'parsing primer text' : 'getting primer';
    functions.logger.error(`Error ${errorType}: ${error}`);
    logLogs(`Error ${errorType}: ${error}`, requestId);
    return {
      system: { role: 'system', content: 'Default system prompt' },
      developer: { role: 'developer', content: 'Default developer prompt' },
    };
  }
};

/**
 * Processes an incoming user message for any supported platform (WhatsApp, Messenger, Instagram).
 * Handles context gathering, personality snapshot, and OpenAI response generation.
 * Updates thread and personality data as needed.
 *
 * @param messageId - Unique message identifier from the platform
 * @param userId - Unique user identifier from the platform
 * @param msgBody - The text content of the user's message
 * @param platform - The platform type (e.g., 'whatsapp', 'messenger', 'instagram')
 * @param attachment - Any media or attachment data from the message
 * @param name - The user's display name
 * @param lastThreadId - The last thread/conversation ID for context
 * @param requestId - Unique request identifier for logging
 * @returns Promise<string> - The AI-generated response
 */
export const processMessage = async (
  messageId: string,
  userId: string,
  msgBody: string,
  platform: PlatformType,
  attachment: any,
  name: string,
  lastThreadId: string | null,
  requestId: string,
): Promise<string> => {
  logLogs(`Message from ${platform}:  ${msgBody}`, requestId);
  logLogs('user info: ' + JSON.stringify(name), requestId);

  if (msgBody.trim() === 'clear') {
    logLogs(`Clearing history for user ${userId}`, requestId);
    return 'All clear';
  }

  // Ensure user has a dossier
  try {
    logLogs(`DOSSIER: Ensuring dossier for user ${userId}`, requestId);
    await ensureUserDossier(userId, name, requestId);
    logLogs(`DOSSIER: Ensured dossier exists for user ${userId}`, requestId);
  } catch (error) {
    functions.logger.warn(
      `DOSSIER: Failed to ensure dossier for user ${userId}: ${error}`,
    );
  }

  // Get primer json from notion
  const { system, developer } = await getPrimer(requestId);
  const systemMessage: string = JSON.stringify(system.content);
  const developerMessage: string = JSON.stringify(developer);
  const currentTime = getHumanReadableDate();
  let response = 'Sorry, I am having troubles lol';
  let customReminder = `Context: The user has just sent the following message now. You are talking with ${name} on ${platform} and you are aware of the current time which may be relevant to the discussion. The current time is ${currentTime}`;
  const imageUrl: string = attachment?.[0]?.payload?.url;
  const isImage: boolean = attachment?.[0]?.type === 'image';
  const isLink: boolean =
    attachment?.[0]?.type === 'fallback' && attachment?.[0]?.payload?.url;

  functions.logger.log(`system message: ${systemMessage}`, requestId);
  functions.logger.log(`developer message: ${developerMessage}`, requestId);

  let formattedPreviousMessages;
  if (platform === 'messenger') {
    try {
      // Previous messages will come in in chronological order with the most recent one at the top, so we need to reverse them to get the correct order where the oldest message is first and the newest message is at the bottom.
      const previousMessagesReversed: MessageThread | null =
        await getPreviousMessages(
          userId,
          20, // Fetch last 20 messages
          platform,
          requestId,
        );
      // Reverse the messages to order them from oldest at the top to newest at the bottom
      const previousMessages = previousMessagesReversed.reverse();

      // Only keep messages that are not empty
      if (previousMessages && previousMessages.length > 0) {
        // Remove the most recent message (last in the array)
        const previousMessagesWithoutLatest = previousMessages.slice(0, -1);
        // Filter out invalid messages from previousMessagesWithoutLatest
        const validMessages = filterValidMessages(
          previousMessagesWithoutLatest,
        );
        // Map valid messages (without the latest user message) to the format expected by the AI
        formattedPreviousMessages = validMessages.map((msg) => ({
          role: msg.from.id === userId ? 'user' : 'assistant',
          content: msg.message,
        }));
        logLogs(
          `Previous messages (formatted): ${JSON.stringify(
            formattedPreviousMessages,
          )}`,
          requestId,
        );
        // Calculate time since last message
        logLogs(
          `last message sent: ${JSON.stringify(previousMessagesReversed[1])}`,
          requestId,
        );
        // Get time since the previous message (before the most recent user message) was sent
        const lastCreatedTime = previousMessagesReversed[1].created_time;
        let timeSinceLastMessage = '';
        if (lastCreatedTime) {
          const lastDate = new Date(lastCreatedTime);
          timeSinceLastMessage = getTimeSince(lastDate);
        }
        customReminder += ` The previous conversational exchange was ${timeSinceLastMessage}.`;
        logLogs(`Time since last message: ${timeSinceLastMessage}`, requestId);
      }
    } catch (error) {
      functions.logger.error(
        `Error fetching previous messages: ${error}`,
        requestId,
      );
    }
  }

  let userMessageContentParts;
  if (isImage && imageUrl) {
    userMessageContentParts = [
      {
        type: 'input_image',
        image_url: imageUrl,
        detail: 'auto',
      },
    ];
  } else if (isLink) {
    const url = attachment?.[0]?.payload?.url;
    const title = attachment?.[0]?.title;
    userMessageContentParts = `Here's a link: ${
      title ? `${title} - ` : ''
    }${url}`;
  } else {
    userMessageContentParts = msgBody;
  }

  const latestUserMessage = {
    role: 'user',
    content: userMessageContentParts,
  };

  const customReminderMessage = {
    role: 'developer',
    content: customReminder,
  };

  const messagesForOpenAI = [
    system,
    developer,
    ...formattedPreviousMessages,
    customReminderMessage,
    latestUserMessage,
  ];

  logLogs(
    `Messages for OpenAI: ${JSON.stringify(messagesForOpenAI)}`,
    requestId,
  );

  // Create user-facing response (no function calls)
  try {
    const responsesResponse = await openAiResponsesRequest({
      input: messagesForOpenAI,
      requestId,
      model: 'gpt-5',
      temperature: 1,
      file_search: true,
      web_search: true,
      previous_response_id:
        formattedPreviousMessages.length > 0 ? null : lastThreadId,
    });

    const hasTextResponse =
      responsesResponse?.output_text &&
      responsesResponse.output_text.trim() !== '';

    if (!responsesResponse || !hasTextResponse) {
      functions.logger.error(
        `No text response from OpenAI: ${JSON.stringify(responsesResponse)}`,
        requestId,
      );
      logLogs('No text response from OpenAI', requestId);
      return 'Sorry, I am having troubles lol';
    }

    response = responsesResponse.output_text;
    logLogs(`User-facing response: ${JSON.stringify(response)}`, requestId);

    // Extract and log file search results if available
    const fileSearchResults = extractFileSearchResults(responsesResponse);
    if (fileSearchResults.length > 0) {
      logLogs(
        `File search provided ${fileSearchResults.length} context results`,
        requestId,
      );
    }

    const newLatestThreadId = responsesResponse?.id;
    updateLastThreadId(userId, newLatestThreadId, name, requestId);

    // Trigger async dossier updates
    processDossierUpdatesAsync(
      userId,
      systemMessage,
      messagesForOpenAI,
      name,
      platform,
      currentTime,
      requestId,
      newLatestThreadId,
      Boolean(imageUrl),
    ).catch((error) => {
      functions.logger.error(
        `Error triggering async dossier updates: ${error}`,
        requestId,
      );
    });

    return response;
  } catch (error) {
    functions.logger.error(`Error processing message: ${error}`);
    return 'sorry, im a bit confused lol';
  }
};

/**
 * Processes dossier updates asynchronously using a separate OpenAI call for function calls
 * @param userId - The user's unique identifier
 * @param grounding - The grounding context for identity
 * @param messagesContext - The conversation messages for context
 * @param userName - The user's display name
 * @param platform - The platform type
 * @param currentTime - Current time string
 * @param requestId - Unique request identifier for logging
 * @param previousResponseId - ID of the previous response for chaining
 * @param isImage - Whether the message is an image
 */
export const processDossierUpdatesAsync = async (
  userId: string,
  grounding: string,
  messagesContext: any[],
  userName: string,
  platform: PlatformType,
  currentTime: string,
  requestId: string,
  previousResponseId: string | null,
  isImage = false,
): Promise<void> => {
  try {
    logLogs(
      `DOSSIER_ASYNC: Starting dossier update generation for user ${userId}`,
      requestId,
    );

    if (isImage) {
      logLogs(
        `DOSSIER_ASYNC: Image detected, skipping dossier updates`,
        requestId,
      );
      return;
    }

    const instructionsForDossier = `${grounding}
    You are tasked with updating a user's dossier based on the conversation.
User: ${userName}
Platform: ${platform}
Current time: ${currentTime}

Based on the conversation, use the available function calls to:
- Record new relationships mentioned (update_user_relationship)
- Capture preferences, interests, or personality traits (update_user_preferences)
- Record your personal diary-like reflections on the conversation's mood, tone, and emotional dynamics (update_user_context)

Use update_user_context like a personal diary to reflect on how the conversation felt, the emotional tone, interesting dynamics, or meaningful moments - NOT to record literal transcripts.

Focus ONLY on generating relevant function calls. Do NOT provide any conversational text response.`;

    const dossierResponse = await openAiResponsesRequest({
      instructions: instructionsForDossier,
      input: messagesContext,
      requestId,
      model: 'gpt-4.1',
      max_output_tokens: 1000,
      temperature: 0.7,
      web_search: false,
      function_tools: dossierFunctionTools,
      tool_choice: 'required',
      file_search: true,
      previous_response_id: previousResponseId,
    });

    if (!dossierResponse) {
      functions.logger.warn(
        `DOSSIER_ASYNC: No response from OpenAI for dossier generation. User: ${userId}`,
        requestId,
      );
      return;
    }

    // Extract and log file search results if available
    const fileSearchResults = extractFileSearchResults(dossierResponse);
    if (fileSearchResults.length > 0) {
      logLogs(
        `DOSSIER_ASYNC: File search provided ${fileSearchResults.length} context results for dossier generation`,
        requestId,
      );
    }

    // Handle any function calls for dossier updates
    let toolCalls: any[] = [];

    // Check for function calls in the output array (correct structure for Responses API)
    if (dossierResponse.output && dossierResponse.output.length > 0) {
      toolCalls = dossierResponse.output.filter(
        (item: any) => item.type === 'function_call',
      );
      logLogs(
        `DOSSIER_ASYNC: Found ${toolCalls.length} function calls in response.output for async processing`,
        requestId,
      );
    } else {
      logLogs(
        'DOSSIER_ASYNC: No response.output array found or it was empty for async processing',
        requestId,
      );
    }

    logLogs(
      `DOSSIER_ASYNC: Found ${toolCalls.length} tool calls to process asynchronously`,
      requestId,
    );

    for (const toolCall of toolCalls) {
      try {
        logLogs(
          `DOSSIER_ASYNC: Processing async function call: ${toolCall.name}`,
          requestId,
        );
        logLogs(
          `DOSSIER_ASYNC: Function call arguments (raw): ${toolCall.arguments}`,
          requestId,
        );

        // According to OpenAI Responses API, function calls have:
        // - toolCall.name (string): function name
        // - toolCall.arguments (string): JSON string of arguments
        const functionName = toolCall.name;
        let functionArgs = {};

        if (toolCall.arguments) {
          try {
            functionArgs = JSON.parse(toolCall.arguments);
            logLogs(
              `DOSSIER_ASYNC: Parsed function arguments: ${JSON.stringify(
                functionArgs,
              )}`,
              requestId,
            );
          } catch (parseError) {
            functions.logger.warn(
              `DOSSIER_ASYNC: Failed to parse function arguments: ${parseError}. Raw arguments: ${toolCall.arguments}`,
            );
            functionArgs = {};
          }
        }

        await handleDossierFunctionCall(
          userId,
          functionName,
          functionArgs,
          requestId,
        );
      } catch (error) {
        functions.logger.warn(
          `DOSSIER_ASYNC: Failed to process async function call: ${error}`,
        );
      }
    }

    logLogs(
      `DOSSIER_ASYNC: Completed async dossier updates for user ${userId}`,
      requestId,
    );
  } catch (error) {
    functions.logger.error(
      `DOSSIER_ASYNC: Error in async dossier processing for user ${userId}: ${error}`,
      requestId,
    );
  }
};
