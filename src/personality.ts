import * as functions from 'firebase-functions/v2';
import { getHumanReadableDate } from './utils';
import { PlatformType, getPreviousMessages } from './facebook';
import { openAiRequest } from './openai';

// Define interfaces for personality analysis
interface PersonalityAnalysis {
  Date: string;
  Summary: string;
  DetailedAccount: string;
  PersonalThoughts: string;
  EmotionDetection: string;
}

// Environment variables
const notionToken = process.env.NOTION_TOKEN;
const personalityBlockId = process.env.PERSONALITY_BLOCK_ID;

/**
 * Updates the Notion database with personality analysis
 */
async function updateNotionWithPersonality(
  personalityData: PersonalityAnalysis,
): Promise<void> {
  try {
    const response = await fetch(
      `https://api.notion.com/v1/blocks/${personalityBlockId}/children`,
      {
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
                    text: { content: JSON.stringify(personalityData) },
                  },
                ],
                language: 'json',
              },
            },
          ],
        }),
      },
    );

    functions.logger.log(`Notion update status: ${response.status}`);
    if (!response.ok) {
      throw new Error(`Notion API returned status ${response.status}`);
    }
  } catch (error) {
    functions.logger.error(`Notion update failed: ${error}`);
  }
}

/**
 * Generate personality analysis from conversation messages
 */
async function generatePersonalityAnalysis(
  name: string,
  messages: Array<{ role: string; content: string }>,
  systemPrompt: string,
): Promise<PersonalityAnalysis> {
  const humanReadableDate = getHumanReadableDate();
  const instruction = `You recently have been texting with ${name} and are going to write down your inner thoughts and judgements about the converation. Remember to be realistic, critical, and judgmental. Remember, these are your inner thoughts so you don't have to be nice. You are very accurate in analyzing people with psychology. Always include ${name}'s name in the entry and remember you are writing about your conversation so keep it in the first person. IMPORTANT: - you are tylr. - you are not an assistant and you are not an ai but rather you are an everyday person with your own opinions.`;

  const aiResponse = await openAiRequest(
    [
      { role: 'system', content: systemPrompt },
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
  if (!aiResponse) throw new Error('Empty AI response');

  return aiResponse as PersonalityAnalysis;
}

/**
 * Analyzes messages to generate personality insights and writes to Notion
 * Returns the personality data for database storage in index.ts
 */
export const getPersonalityAnalysis = async (
  name: string,
  userId: string,
  system: string,
  platform: PlatformType,
): Promise<any> => {
  try {
    // Fetch conversation messages
    const thread = await getPreviousMessages(userId, 10, platform);
    functions.logger.log(
      `Fetched ${thread.length} messages for user ${userId}`,
    );

    // Format messages for analysis
    const conversationMessages = thread
      .map(({ id, message }) => ({
        role: id === userId ? 'user' : 'assistant',
        content: message,
      }))
      .slice(-6);
    functions.logger.log(
      `Prepared ${conversationMessages.length} messages for analysis`,
    );

    // Generate personality analysis
    const personalityAnalysis = await generatePersonalityAnalysis(
      name,
      conversationMessages,
      system,
    );

    // Store in Notion
    await updateNotionWithPersonality(personalityAnalysis);

    return personalityAnalysis;
  } catch (error: any) {
    functions.logger.error(`getPersonalityAnalysis failed: ${error}`);
    return null;
  }
};
