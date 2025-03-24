/* eslint-disable @typescript-eslint/no-explicit-any */
import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import axios from 'axios';
import admin from 'firebase-admin';
import { openAiRequest } from './openai';
import { logLogs, logTime, logs } from './utils';
import {
  facebookGraphRequest,
  sendWhatsAppReceipt,
  sendMessengerReceipt,
  sendMessengerMessage,
  sendWhatsAppMessage,
  extractWhatsAppMessageDetails
} from './facebook';

const openaitoken = process.env.OPENAI_API_KEY ?? '';
const openAiOrgId = process.env.OPENAI_ORG_ID;
const verifyToken = process.env.VERIFY_TOKEN;
const notionToken = process.env.NOTION_TOKEN;
const notionBlockId = process.env.NOTION_BLOCK_ID;
const personalityBlockId = process.env.PERSONALITY_BLOCK_ID;
const assistantId = process.env.ASSISTANT_ID;

interface RunOptions {
  assistant_id: string;
  model: string;
  additional_instructions: string;
  instructions?: string; // Optional property
}

import OpenAI from 'openai';
const configuration = {
  organization: openAiOrgId,
  apiKey: openaitoken,
};

const openai = new OpenAI(configuration);

admin.initializeApp();
const database = admin.database();

const currentTime = new Date().toLocaleString('en-US', {
  timeZone: 'America/Los_Angeles',
});

const getPrimer = async () => {
  const start = Date.now();
  try {
    const response = await axios({
      method: 'get',
      maxBodyLength: Infinity,
      url: `https://api.notion.com/v1/blocks/${notionBlockId}`,
      headers: {
        'Notion-Version': '2022-02-22',
        Authorization: `Bearer ${notionToken}`,
      },
    });
    const primerText = response.data.code.rich_text[0].plain_text;
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

const storeThreadId = async (from: string, thread: any, userName: string) => {
  logLogs('Storing openAi thread id with in Database');
  const { id, metadata, created_at, object } = thread;
  try {
    database.ref(`users/${from}/thread`).set({
      id,
      metadata,
      created_at,
      object,
      userName,
    });
  } catch (error) {
    functions.logger.error(`Error storing thread id: ${error}`);
  }
};

const updateAssistant = async (instructions: string) => {
  const start = Date.now();
  logLogs('Updating assistant');
  await openai.beta.assistants
    .update(assistantId ?? '', {
      instructions,
    })
    .then((res) => {
      logTime(start, 'updateAssistant');
      logLogs(`Assistant updated: ${JSON.stringify(res)}`);
    })
    .catch((error) => {
      functions.logger.error(`Error updating assistant: ${error}`);
    });
  return;
};

const storePersonalityAnalysis = async (
  name: string,
  from: string,
  threadMessages: Array<any>,
  system: string,
) => {
  const start = Date.now();
  const humanReadableDate = new Date(start).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
  });
  logLogs('Storing personality in Database');
  // check if thread id exists
  try {
    const userRef = database.ref(`users/${from}`);
    const userSnapshot = await userRef.once('value');
    const userInfoSnapshot = userSnapshot.val();

    // get last 10 messages
    const messages = threadMessages
      .map((message) => {
        return {
          role: message.role,
          content: message.content[0]?.text?.value,
        };
      })
      .reverse()
      .slice(-6);
    functions.logger.log(
      `message with ${name}. recent messages: ${JSON.stringify(messages)}`,
    );
    if (!userInfoSnapshot) {
      return;
    }
    const instruction = `You recently have been texting with ${name} and are going to write down your inner thoughts and judgements about the converation. Remember to be realistic, critical, and judgmental. Remember, these are your inner thoughts so you don't have to be nice. You are very accurate in analyzing people with psychology. Always include ${name}'s name in the entry and remember you are writing about your conversation so keep it in the first person. IMPORTANT: - you are tylr. - you are not an assistant and you are not an ai but rather you are an everyday person with your own opinions.`;

    const newPersonality = await openAiRequest(
      [
        { role: 'system', content: system },
        ...messages,
        { role: 'system', content: instruction },
      ],
      'gpt-4o-mini',
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
    database.ref(`users/${from}/personality`).set({
      personality: newPersonality,
    });
    try {
      logLogs('Updating personality in Notion');
      const data = {
        children: [
          {
            object: 'block',
            type: 'code',
            code: {
              rich_text: [
                {
                  type: 'text',
                  text: {
                    content: JSON.stringify(newPersonality),
                  },
                },
              ],
              language: 'json',
            },
          },
        ],
      };
      const headers = {
        'Notion-Version': '2022-02-22',
        Authorization: `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
      };
      fetch(`https://api.notion.com/v1/blocks/${personalityBlockId}/children`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(data),
      })
        .then((res) => res.json())
        .then((data) => {
          logLogs(`Notion response: ${JSON.stringify(data)}`);
        })
        .catch((error) => {
          console.error('Error:', error);
        });
      logTime(start, 'updateAssistant');
    } catch (error) {
      functions.logger.error(`Error updating personality: ${error}`);
    }
  } catch (error) {
    functions.logger.error(`Error storing thread id: ${error}`);
  }
};

const getThread = async (from: string, platform: string) => {
  const start = Date.now();
  logLogs('getting thread id from firestore');
  try {
    const userRef = database.ref(`users/${from}`);
    const userSnapshot = await userRef.once('value');
    const userInfoSnapshot = userSnapshot.val();

    if (!userInfoSnapshot) {
      logLogs('No user found, creating new thread');
      let userName = 'someone';
      if (platform === 'messenger') {
        const userInfo = await facebookGraphRequest(
          `me/conversations?fields=senders&user_id=${from}&`,
          {},
          'Error while getting Messenger name',
          'GET',
        );
        userName = userInfo?.data.data[0].senders.data[0].name;
      } else if (platform === 'instagram') {
        const userInfo = await facebookGraphRequest(
          `me/conversations?fields=name&platform=instagram&user_id=${from}&`,
          {},
          'Error while getting Instagram name',
          'GET',
        );
        userName = userInfo?.data.data[0].name;
      }
      const thread = await openai.beta.threads.create({
        metadata: {
          userId: from,
          name: userName,
          platform,
        },
      });
      storeThreadId(from, thread, userName);
      logTime(start, 'getThreadId');
      return thread;
    }
    const thread = userInfoSnapshot.thread;
    logTime(start, 'getThreadId');
    return thread;
  } catch (error) {
    functions.logger.error(`Error getting thread id: ${error}`);
    logTime(start, 'getThreadId');
    return;
  }
};

const processMessage = async (
  messageId: string,
  userId: string,
  msgBody: string,
  platform: string,
  attachment: any,
  name: string,
  thread: string,
) => {
  logLogs(`Message from ${platform}:  ${msgBody}`);
  logLogs('user info: ' + JSON.stringify(name));
  // Get primer json from notion
  const { system, primer, reminder } = await getPrimer();
  let userMessage = msgBody;
  let instructions = '';
  let response = 'Sorry, I am having troubles lol';
  const customReminder = `you are talking with ${name} on ${platform} and the current time is ${currentTime}`;
  if (attachment) {
    const imageMessage = [
      {
        type: 'text',
        text: ' Visualize and describe the contents of the image thoroughly, focusing on the setting, objects, people (noting their actions, expressions, and emotions), colors, and atmosphere. Pay special attention to the context and any text included in the image. Then, if it is a meme, explain the humor by noting cultural references and the contrast that makes it funny.',
      },
      {
        type: 'image_url',
        image_url: attachment ? attachment[0]?.payload?.url : '',
      },
    ];
    const imageInterpretation = await openAiRequest(
      [{ role: 'user', content: imageMessage, name: 'someone' }],
      'gpt-4o',
      2000,
      1,
    );
    userMessage = `I sent you a photo. This is the detailed description: ${imageInterpretation}. Reply as if you saw this image as an image that i sent to you and not as text.`;
  }
  const userDB = await database
    .ref(`users/${userId}/personality`)
    .once('value');
  const personalitySnapshot = userDB.val();
  logLogs(`recent thoughts: ${JSON.stringify(personalitySnapshot)}`);
  const personalityString = `These are your most recent thoughts: ${personalitySnapshot?.personality}`;
  instructions = `${system[0].content} | ${primer[0].content} | ${personalityString} | ${reminder[0].content}`;
  logLogs(`Instructions: ${instructions}`);
  updateAssistant(instructions);
  await openai.beta.threads.messages.create(thread, {
    role: 'user',
    content: userMessage,
    metadata: {
      messageId,
    },
  });

  // Check if another message was added after processing
  const getThread = await openai.beta.threads.messages.list(thread);
  const threadMessages = getThread?.data;
  let lastMessageId = (threadMessages[0]?.metadata as any)?.messageId as
    | string
    | null;
  // add delay to wait for message to be added
  await new Promise((resolve) => setTimeout(resolve, 2000));
  if (platform === 'messenger') {
    const messengerMessages = await facebookGraphRequest(
      `me/conversations?fields=messages.limit(1){created_time,from,message}&user_id=${userId}&`,
      {},
      'Error while getting Messenger name',
      'GET',
    );
    lastMessageId = await messengerMessages?.data?.data[0]?.messages?.data[0]
      ?.id;
  } else {
    functions.logger.warn(`Using thread message id: ${lastMessageId}`);
  }
  if (lastMessageId) {
    if (lastMessageId !== messageId) {
      functions.logger.warn('New message was added, exiting');
      return '';
    }
    logLogs(`No new messages, continuing...`);
  }
  const runOptions: RunOptions = {
    assistant_id: assistantId ?? '',
    model: 'gpt-4.5-preview',
    additional_instructions: customReminder,
  };
  if (instructions != '') {
    runOptions.instructions = instructions;
  }

  try {
    const run = await openai.beta.threads.runs.createAndPoll(thread, {
      assistant_id: assistantId ?? '',
    });

    let runStatus = await openai.beta.threads.runs.retrieve(thread, run.id);
    let retryCount = 0;
    const maxRetries = 3;
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();

    while (runStatus.status !== 'completed') {
      logLogs(`Run status: ${runStatus.status}`);

      // Check if we've exceeded max wait time
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Run timed out after 30 seconds');
      }

      // Handle error states
      if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
        const errorDetails = {
          status: runStatus.status,
          error: runStatus.last_error?.message || 'Unknown error',
          code: runStatus.last_error?.code || 'NO_CODE',
          timestamp: new Date().toISOString(),
        };

        functions.logger.error('Run failed:', errorDetails);

        // If we haven't exceeded max retries, try again
        if (retryCount < maxRetries) {
          logLogs(`Retrying run (attempt ${retryCount + 1}/${maxRetries})`);
          retryCount++;

          // Create a new run
          const newRun = await openai.beta.threads.runs.createAndPoll(thread, {
            assistant_id: assistantId ?? '',
          });
          runStatus = await openai.beta.threads.runs.retrieve(
            thread,
            newRun.id,
          );
          continue;
        }

        throw new Error(
          `Run failed after ${maxRetries} retries: ${errorDetails.error}`,
        );
      }

      // Wait before checking status again
      await new Promise((resolve) => setTimeout(resolve, 2000));
      runStatus = await openai.beta.threads.runs.retrieve(thread, run.id);
    }

    const messages = await openai.beta.threads.messages.list(thread);
    const lastMessage = messages.data
      .filter(
        (message) => message.run_id === run.id && message.role === 'assistant',
      )
      .pop()?.content[0];

    if (lastMessage?.type === 'text') {
      response = lastMessage?.text.value;
    } else {
      throw new Error('No valid response message found');
    }

    // Store personality analysis only if we got a valid response
    await storePersonalityAnalysis(
      name,
      userId,
      threadMessages,
      system[0].content,
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    functions.logger.error('Error in processMessage:', {
      error: errorMessage,
      userId,
      platform,
      messageId,
    });
  }

  return response;
};

const checkIfNeedAgent = async (message: string, userId, platform) => {
  const agentPhrases = [
    'agent',
    'real person',
    'human',
    'help',
    'support',
    'talk to someone',
    'talk to a person',
    'talk to a human',
    'talk to a real person',
    'talk to a real human',
  ];
  // get an agent if the message contains any of the agent phrases and is on instagram
  const needAgent =
    agentPhrases.some((phrases) => message.includes(phrases)) &&
    platform === 'instagram';
  logLogs(`Need an agent from this message: ${needAgent}`);
  if (needAgent === true) {
    await sendMessengerMessage(
      userId,
      'I am connecting you with a real agent. Tyler will be with you within 24 hours.',
      platform,
    );
  } /* else {
    const recentMessages = await getPreviousMessages(userId, 5, platform);
    if (recentMessages) {
      const recentMessagesString = JSON.stringify(recentMessages);
      if (
        recentMessagesString.includes('I am connecting you with a real agent')
      ) {
        needAgent = true;
        logLogs(`Recently requested agent`);
      }
    }
  } */
  return needAgent;
};

const app = async (req, res) => {
  const startTime = Date.now();
  logLogs('running app function!');
  functions.logger.info(JSON.stringify(req.body));
  // Webhook verification
  if (req.method === 'GET') {
    logLogs('Processing GET request');
    functions.logger.info(req, { structuredData: true });

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        logLogs('WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
      }
      return res.sendStatus(403);
    }
    return res.sendStatus(404);
  }
  if (req.method === 'POST') {
    res.sendStatus(200);
    logLogs('Processing POST request');
    let platform = req.body.object;
    // WhatsApp
    if (platform === 'whatsapp_business_account') {
      platform = 'whatsapp';
      logLogs('Processing whatsapp request');
      if (
        req.body.entry &&
        req.body.entry[0].changes &&
        req.body.entry[0].changes[0] &&
        req.body.entry[0].changes[0].value &&
        req.body.entry[0].changes[0].value.status
      ) {
        return logLogs('Status change');
      } else if (
        req.body.entry &&
        req.body.entry[0].changes &&
        req.body.entry[0].changes[0] &&
        req.body.entry[0].changes[0].value.messages &&
        req.body.entry[0].changes[0].value.messages[0]
      ) {
        const { messageId, userId, msgBody, name, phoneNumberId, msgId } =
          extractWhatsAppMessageDetails(req);
        sendWhatsAppReceipt(phoneNumberId, msgId);
        // Get user thread
        const thread = await getThread(userId, platform);
        const aiResponse = await processMessage(
          messageId,
          userId,
          msgBody,
          platform,
          null,
          name,
          thread,
        );
        await sendWhatsAppMessage(phoneNumberId, userId, aiResponse);
        return logLogs('Finished WhatsApp function');
      }
      return logLogs('Not a status change or message');
    }
    // Messenger or Instagram
    if (platform === 'page' || platform === 'instagram') {
      logLogs('Processing page request');
      if (platform === 'page') {
        platform = 'messenger';
      }
      const entry = req.body.entry[0];
      if (entry.messaging) {
        const userId = entry.messaging[0].sender.id;
        const messageId = entry.messaging[0].message.mid ?? '';
        const msgBody = entry.messaging[0].message.text ?? '';
        const attachment = entry.messaging[0]?.message?.attachments ?? null;
        // Mark message as seen if Messenger
        if (platform === 'messenger') {
          sendMessengerReceipt(userId, 'mark_seen').then(() => {
            sendMessengerReceipt(userId, 'typing_on');
          });
        }
        // Get user thread
        const thread = await getThread(userId, platform);
        const threadId = thread?.id;
        const name = thread?.metadata?.name;
        // Check if message is looking for an agent
        const needAgent = await checkIfNeedAgent(msgBody, userId, platform);
        if (needAgent) {
          return logLogs('Agent needed');
        }
        const aiResponse = await processMessage(
          messageId,
          userId,
          msgBody,
          platform,
          attachment,
          name,
          threadId,
        );
        if (platform === 'messenger') {
          sendMessengerReceipt(userId, 'typing_off');
        }
        if (aiResponse === '') {
          return logLogs('No response needed');
        }
        await sendMessengerMessage(userId, aiResponse, platform);
        logTime(startTime, 'Whole function time:');
        functions.logger.log(logs);
        return functions.logger.debug('Finished Messenger function');
      }
      return logLogs('Not a message');
    }
    return res.sendStatus(404).send();
  }
  return logLogs('Running for no reason...');
};

export const webhook = onRequest(app);
