import * as functions from 'firebase-functions/v2';
import { ResponseInputMessageContentList } from 'openai/resources/responses/responses';
import {
  getPersonality,
  updateLastThreadId,
  updatePersonality,
} from './database';
import { PlatformType } from './facebook';
import { openAiResponsesRequest, updateAssistant } from './openai';
import { getPersonalityAnalysis } from './personality';
import { getHumanReadableDate, logLogs, logTime } from './utils';

const notionToken = process.env.NOTION_TOKEN;
const notionBlockId = process.env.NOTION_BLOCK_ID;
const assistantId = process.env.ASSISTANT_ID;

export const getPrimer = async () => {
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
      logTime(start, 'getPrimer');
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
): Promise<string> => {
  logLogs(`Message from ${platform}:  ${msgBody}`);
  logLogs('user info: ' + JSON.stringify(name));
  // Get primer json from notion
  const { system, primer, reminder } = await getPrimer();
  let userMessage: ResponseInputMessageContentList | string = msgBody;
  let instructions = '';
  const currentTime = getHumanReadableDate();
  let response = 'Sorry, I am having troubles lol';
  const customReminder = `You are talking with ${name} on ${platform} and you are aware of the current time which may be relevant to the discussion. The current time is ${currentTime}`;
  const imageUrl: string = attachment?.[0]?.payload?.url;
  if (imageUrl) {
    userMessage = [
      {
        type: 'input_image',
        image_url: imageUrl,
        detail: 'auto',
      },
    ];
  }

  const personalitySnapshot = await getPersonality(userId);
  functions.logger.info(
    `recent thoughts: ${JSON.stringify(personalitySnapshot)}`,
  );
  const personalityString = `These are your most recent thoughts: ${personalitySnapshot?.personality}`;
  instructions = `${system[0].content} | ${primer[0].content} | ${personalityString} | ${reminder[0].content}`;
  logLogs(`Instructions: ${instructions}`);

  // Update assistant with instructions
  const shouldUpdateAssistant = false;
  if (shouldUpdateAssistant) {
    await updateAssistant(instructions, assistantId ?? '');
  } else {
    logLogs('Assistant update skipped.');
  }

  await openAiResponsesRequest(
    [
      { role: 'system', content: instructions },
      { role: 'user', content: userMessage },
      { role: 'system', content: customReminder },
    ],
    imageUrl ? 'gpt-4.1' : 'ft:gpt-4.1-2025-04-14:tylr:4point1-1:BMMQRXVQ',
    4000,
    1,
    true,
    lastThreadId,
  )
    .then(async (responsesResponse) => {
      if (!responsesResponse || responsesResponse?.output_text === '') {
        logLogs('No response from OpenAI');
        return 'Sorry, I am having troubles lol';
      }
      response = responsesResponse.output_text;
      logLogs(`Response: ${JSON.stringify(response)}`);
      const newLatestThreadId = responsesResponse?.id;
      updateLastThreadId(userId, newLatestThreadId, name);

      // Get personality analysis and store it in database
      const personalityData = await getPersonalityAnalysis(
        name,
        userId,
        system[0].content,
        platform,
      );
      if (personalityData) {
        await updatePersonality(userId, personalityData);
      }

      return response;
    })
    .catch((error) => {
      functions.logger.error(`Error processing message: ${error}`);
      return 'sorry, im a bit confused lol';
    });

  return response;
};
