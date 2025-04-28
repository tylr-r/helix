import * as functions from 'firebase-functions/v2';
import admin from 'firebase-admin';
import { getHumanReadableDate } from './utils';
import { PlatformType, getPreviousMessages } from './facebook';
import { openAiRequest } from './openai';

// Import environment variables
const notionToken = process.env.NOTION_TOKEN;
const personalityBlockId = process.env.PERSONALITY_BLOCK_ID;

// Get database reference
const database = admin.database();

/**
 * Analyzes messages to generate personality insights and stores them in database and Notion
 */
export const storePersonalityAnalysis = async (
  name: string,
  userId: string,
  system: string,
  platform: PlatformType,
) => {
  const humanReadableDate = getHumanReadableDate();

  try {
    const thread = await getPreviousMessages(userId, 10, platform);
    functions.logger.log(
      `Fetched ${thread.length} messages for user ${userId}`,
    );

    const messages = thread
      .map(({ id, message }) => ({
        role: id === userId ? 'user' : 'assistant',
        content: message,
      }))
      .slice(-6);
    functions.logger.log(`Prepared ${messages.length} messages for analysis`);

    const instruction = `You recently have been texting with ${name} and are going to write down your inner thoughts and judgements about the converation. Remember to be realistic, critical, and judgmental. Remember, these are your inner thoughts so you don't have to be nice. You are very accurate in analyzing people with psychology. Always include ${name}'s name in the entry and remember you are writing about your conversation so keep it in the first person. IMPORTANT: - you are tylr. - you are not an assistant and you are not an ai but rather you are an everyday person with your own opinions.`;

    const newPersonality = await openAiRequest(
      [
        { role: 'system', content: system },
        ...messages,
        { role: 'system', content: instruction },
      ],
      'gpt-4.1-mini',
      3000,
      0.8,
      true,
      [
        {
          name: 'personality',
          description: `Update your journal of your personal thoughts and opinions that include unique facts based on your conversation with ${name} at ${humanReadableDate}.`,
          parameters: {
            type: 'object',
            properties: {
              Date: {
                type: 'string',
                description: humanReadableDate,
              },
              Summary: {
                type: 'string',
                description: `This is your inner dialog recapping a brief summary of the main topic of the conversation with ${name} for context`,
              },
              DetailedAccount: {
                type: 'string',
                description: `A detailed account of the conversation with ${name}, highlighting key facts and details that you found interesting or important. Include the date and time of day. Include any unique facts about ${name} that you discovered during the conversation.`,
              },
              PersonalThoughts: {
                type: 'string',
                description: `Your personal analysis of the conversation including any doubts, concerns, or critical viewpoints about ${name} and thoughts about their reaction to what you have to say. These are notes to yourself to remember in the future. Include critical judgements or skepticism as well. These are your subjective opinions.`,
              },
              EmotionDetection: {
                type: 'string',
                description: `Your analysis of ${name}'s emotions and feelings during the conversation. Include any observations about their emotional state and how it may have influenced the conversation.`,
              },
            },
            required: [
              'Summary',
              'DetailedAccount',
              'PersonalThoughts',
              'EmotionDetection',
            ],
          },
        },
      ],
    );
    functions.logger.log('OpenAI returned personality object');
    if (!newPersonality) throw new Error('Empty AI response');

    await database
      .ref(`users/${userId}/personality`)
      .set({ personality: newPersonality });
    functions.logger.log('Firebase write OK');

    fetch(`https://api.notion.com/v1/blocks/${personalityBlockId}/children`, {
      method: 'PATCH',
      headers: {
        'Notion-Version': '2022-02-22',
        Authorization: `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        children: [
          {
            object: 'block',
            type: 'code',
            code: {
              rich_text: [
                {
                  type: 'text',
                  text: { content: JSON.stringify(newPersonality) },
                },
              ],
              language: 'json',
            },
          },
        ],
      }),
    })
      .then((res) =>
        functions.logger.log(`Notion update status: ${res.status}`),
      )
      .catch((error) =>
        functions.logger.error(`Notion update failed: ${error}`),
      );
  } catch (error: any) {
    functions.logger.error(`storePersonalityAnalysis failed: ${error}`);
  }
};
