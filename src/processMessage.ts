import * as functions from 'firebase-functions/v2';
import { getPersonality, updateLastThreadId } from './database';
import { getPreviousMessages, MessageThread, PlatformType } from './facebook';
import { openAiResponsesRequest } from './openai';
import { createPersonalityAnalysis } from './personality';
import { getHumanReadableDate, getTimeSince, logLogs, logTime } from './utils';

const notionToken = process.env.NOTION_TOKEN;
const notionBlockId = process.env.NOTION_BLOCK_ID;

export const getPrimer = async (requestId: string) => {
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
    try {
      const parsedPrimer = JSON.parse(primerText);
      logTime(start, 'getPrimer', requestId);
      return parsedPrimer;
    } catch (error) {
      functions.logger.error(`Error parsing primer text: ${error}`);
    }
  } catch (error) {
    functions.logger.error(`Error getting primer: ${error}`);
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
 * @returns Promise<string> - The AI-generated response to send back to the user
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
  // Get primer json from notion
  const { system } = await getPrimer(requestId);
  let instructions = '';
  const currentTime = getHumanReadableDate();
  let response = 'Sorry, I am having troubles lol';
  let customReminder = `You are talking with ${name} on ${platform} and you are aware of the current time which may be relevant to the discussion. The current time is ${currentTime}`;
  const imageUrl: string = attachment?.[0]?.payload?.url;

  const personalitySnapshot = await getPersonality(userId);
  functions.logger.info(
    `recent thoughts: ${JSON.stringify(personalitySnapshot)}`,
  );
  const personalityString = `These are your most recent thoughts: ${personalitySnapshot?.personality}`;
  instructions = `${system[0].content} | ${personalityString}`;
  logLogs(`Instructions: ${instructions}`, requestId);

  const systemInstructionMessage = {
    role: 'system',
    content: instructions,
  };

  let formattedPreviousMessages;
  if (platform === 'messenger') {
    try {
      const previousMessagesReverse: MessageThread | null =
        await getPreviousMessages(
          userId,
          20, // Fetch last 20 messages
          platform,
          requestId,
        );
      const previousMessages = previousMessagesReverse.reverse();

      if (previousMessages && previousMessages.length > 0) {
        // Remove the most recent message (last in the array)
        const previousMessagesWithoutLatest = previousMessages
          .reverse()
          .slice(0, -1);
        formattedPreviousMessages = previousMessagesWithoutLatest.map(
          (msg) => ({
            role: msg.from.id === userId ? 'user' : 'assistant',
            content: msg.message,
          }),
        );
        // Calculate time since last message
        logLogs(
          `last message sent: ${JSON.stringify(previousMessages[1])}`,
          requestId,
        );
        const lastCreatedTime = previousMessages[1].created_time;
        let timeSinceLastMessage = '';
        if (lastCreatedTime) {
          const lastDate = new Date(lastCreatedTime);
          timeSinceLastMessage = getTimeSince(lastDate);
        }
        customReminder += ` The time since the last message is ${timeSinceLastMessage}.`;
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
  if (imageUrl) {
    userMessageContentParts = [
      {
        type: 'input_image',
        image_url: imageUrl,
        detail: 'auto',
      },
    ];
  } else {
    userMessageContentParts = msgBody;
  }

  const latestUserMessage = {
    role: 'user',
    content: userMessageContentParts,
  };

  const customReminderMessage = {
    role: 'system',
    content: customReminder,
  };

  const messagesForOpenAI = [
    systemInstructionMessage,
    ...formattedPreviousMessages,
    latestUserMessage,
    customReminderMessage,
  ];

  logLogs(
    `Messages for OpenAI: ${JSON.stringify(messagesForOpenAI)}`,
    requestId,
  );

  // Create response message
  await openAiResponsesRequest(
    messagesForOpenAI,
    requestId,
    imageUrl ? 'gpt-4.1' : 'ft:gpt-4.1-2025-04-14:tylr:4point1-1:BMMQRXVQ',
    4000,
    1,
    true,
    formattedPreviousMessages.length > 0 ? null : lastThreadId,
  )
    .then(async (responsesResponse) => {
      if (!responsesResponse || responsesResponse?.output_text === '') {
        logLogs('No response from OpenAI', requestId);
        return 'Sorry, I am having troubles lol';
      }
      response = responsesResponse.output_text;
      logLogs(`Response: ${JSON.stringify(response)}`, requestId);
      const newLatestThreadId = responsesResponse?.id;
      updateLastThreadId(userId, newLatestThreadId, name, requestId);

      createPersonalityAnalysis(
        name,
        userId,
        system[0].content,
        platform,
        requestId,
      );

      return response;
    })
    .catch((error) => {
      functions.logger.error(`Error processing message: ${error}`);
      return 'sorry, im a bit confused lol';
    });

  return response;
};
