/* eslint-disable @typescript-eslint/no-explicit-any */
import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import axios from 'axios';
import admin from 'firebase-admin';

const openaitoken = process.env.OPENAI_API_KEY ?? '';
const openAiOrgId = process.env.OPENAI_ORG_ID;
const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
const verifyToken = process.env.VERIFY_TOKEN;
const notionToken = process.env.NOTION_TOKEN;
const notionBlockId = process.env.NOTION_BLOCK_ID;
const personalityBlockId = process.env.PERSONALITY_BLOCK_ID;
const assistantId = process.env.ASSISTANT_ID;
const tylrId = process.env.TYLR_ID;

import OpenAI from 'openai';
const configuration = {
  organization: openAiOrgId,
  apiKey: openaitoken,
};

const openai = new OpenAI(configuration);

admin.initializeApp();
const database = admin.database();

// aggregate logs together
const logs: string[] = [];
const logLogs = (log: any) => {
  functions.logger.log(log);
  logs.push(log);
};

const logTime = async (start: number, label: any) => {
  const end = Date.now();
  logLogs(`Time to ${label}: ${end - start}ms`);
};

const currentTime = new Date().toLocaleString('en-US', {
  timeZone: 'America/Los_Angeles',
});

const facebookGraphRequest = async (
  endpoint: string,
  data: any,
  errorMsg: string,
  method: string,
) => {
  const start = Date.now();
  try {
    const response = await axios({
      method,
      url: `https://graph.facebook.com/v16.0/${endpoint}access_token=${pageAccessToken}`,
      data,
      headers: { 'Content-Type': 'application/json' },
    });
    logTime(start, 'sendFBGraphRequest');
    return response;
  } catch (error: any) {
    if (error.response && error.response.data) {
      const detailedErrorMsg = JSON.stringify(error.response.data);
      return functions.logger.error(`${errorMsg}: ${detailedErrorMsg}`);
    } else if (error.request) {
      // The request was made but no response was received
      return functions.logger.error(`${errorMsg}: No response received.`);
    } else {
      // Something happened in setting up the request that triggered an Error
      return functions.logger.error(`${errorMsg}: ${error.message}`);
    }
  }
};

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

const sendWhatsAppReceipt = async (phone_number_id: string, msgId: string) => {
  await facebookGraphRequest(
    `${phone_number_id}/messages?`,
    {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: msgId,
    },
    'Error while marking WhatsApp as seen',
    'POST',
  );
};

// Send Messenger receipt
const sendMessengerReceipt = async (userId: string, sender_action: string) => {
  await facebookGraphRequest(
    'me/messages?',
    {
      recipient: { id: userId },
      sender_action,
    },
    `Error while sending Messenger action: ${sender_action}`,
    'POST',
  );
};

// Send Messenger message
const sendMessengerMessage = async (
  userId: string,
  response: string,
  platform: string,
) => {
  logLogs(`Sending ${platform} message to ${userId}`);
  await facebookGraphRequest(
    'me/messages?',
    {
      recipient: { id: userId },
      message: { text: `${response}` },
    },
    `Error while sending ${platform} message`,
    'POST',
  );
};

// Send WhatsApp message
const sendWhatsAppMessage = async (
  phoneNumberId: string,
  userId: string,
  response: string,
) => {
  logLogs('Sending WhatsApp message');
  await facebookGraphRequest(
    `${phoneNumberId}/messages?`,
    {
      messaging_product: 'whatsapp',
      to: userId,
      text: { body: `${response}` },
    },
    'Error while sending WhatsApp message',
    'POST',
  );
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
  await openai.beta.assistants.update(assistantId ?? '', {
    instructions,
  });
  logTime(start, 'updateAssistant');
  return;
};

const storePersonalityAnalysis = async (
  from: string,
  threadMessages: Array<any>,
) => {
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
      .slice(-2);
    if (!userInfoSnapshot) {
      return;
    }
    // const currentPersonality: string = userInfoSnapshot.personality ?? {};
    const instruction = `You are analyzing the personality of the user you are talking to. Update this personality based on the user's messages. Make sure every section is filled out with something and constantly updated. No section should be empty`;
    const newPersonality = await openAiRequest(
      [...messages, { role: 'system', content: instruction }],
      'gpt-4-1106-preview',
      3000,
      0.2,
      true,
      [
        {
          name: 'personality',
          description:
            "Update this personality based on the user's messages. Make sure every section is filled out in full detail with your best assumptions and constantly updated. No section should be empty",
          parameters: {
            type: 'object',
            properties: {
              openness: { type: 'string', enum: ['low', 'medium', 'high'] },
              conscientiousness: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
              },
              extraversion: { type: 'string', enum: ['low', 'medium', 'high'] },
              agreeableness: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
              },
              neuroticism: { type: 'string', enum: ['low', 'medium', 'high'] },
              creativity: { type: 'string', enum: ['low', 'medium', 'high'] },
              empathy: { type: 'string', enum: ['low', 'medium', 'high'] },
              resilience: { type: 'string', enum: ['low', 'medium', 'high'] },
              optimism: { type: 'string', enum: ['low', 'medium', 'high'] },
              adaptability: { type: 'string', enum: ['low', 'medium', 'high'] },
              honesty: { type: 'string', enum: ['low', 'medium', 'high'] },
              patience: { type: 'string', enum: ['low', 'medium', 'high'] },
              leadership: { type: 'string', enum: ['low', 'medium', 'high'] },
              altruism: { type: 'string', enum: ['low', 'medium', 'high'] },
              self_discipline: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
              },
              emotional_intelligence: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
              },
              flexibility: { type: 'string', enum: ['low', 'medium', 'high'] },
              casualness: { type: 'string', enum: ['low', 'medium', 'high'] },
              seriousness: { type: 'string', enum: ['low', 'medium', 'high'] },
              likes: {
                type: 'string',
                description: 'What do they like? Keep adding to this list',
              },
              dislikes: {
                type: 'string',
                description: 'What do they dislike? Keep adding to this list',
              },
              transactional_analysis: {
                type: 'string',
                description:
                  'Three major aspects of our personality: the Parent, the Adult, and the Child. Each one influences our communication and behavior. What role are they in?',
              },
              personality_description: {
                type: 'string',
                description:
                  'Summarize the personality of the user. This must be at least a few sentences (required). Are they looking for a more playful exchange? Update this section so that the AI can better understand the user.',
              },
              message_writing_style: {
                type: 'string',
                description:
                  'Summarize the writing style of the user in at least few sentences (required). Do they use emojis? Are they formal? Do they use slang? Do they use punctuation? Do they use capitalization?',
              },
            },
            required: [
              'openness',
              'conscientiousness',
              'extraversion',
              'agreeableness',
              'neuroticism',
              'creativity',
              'empathy',
              'resilience',
              'optimism',
              'adaptability',
              'honesty',
              'patience',
              'leadership',
              'altruism',
              'self_discipline',
              'emotional_intelligence',
              'flexibility',
              'casualness',
              'seriousness',
              'likes',
              'dislikes',
              'transactional_analysis',
              'personality_description',
              'message_writing_style',
            ],
          },
        },
      ],
    );
    logLogs(`New personality: ${newPersonality}`);
    database.ref(`users/${from}/personality`).set({
      personality: newPersonality,
    });
    try {
      logLogs('Updating personality in Notion');
      const data = {
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
      };
      const headers = {
        'Notion-Version': '2022-02-22',
        Authorization: `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
      };
      fetch(`https://api.notion.com/v1/blocks/${personalityBlockId}`, {
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

const openAiRequest = async (
  messages: any[],
  model: string,
  max_tokens?: number,
  temperature?: number,
  function_call?: boolean,
  ai_functions?: any[],
) => {
  const start = Date.now();
  let completion;
  try {
    if (function_call && ai_functions !== undefined) {
      logLogs('Starting openai function call');
      const name = ai_functions[0].name;
      completion = await openai.chat.completions
        .create({
          model: 'gpt-3.5-turbo',
          messages,
          max_tokens,
          temperature,
          function_call: {
            name,
          },
          functions: ai_functions,
        })
        .catch((error) => {
          functions.logger.error(`Error sending to OpenAI: ${error}`);
        });
      functions.logger.info(`Usage: ${JSON.stringify(completion?.usage)}`);
      const result = completion?.choices[0].message.function_call.arguments;
      logTime(start, 'openAiRequest');
      return result;
    } else {
      logLogs('Starting normal openai call');
      functions.logger.debug(
        `normal call: ${JSON.stringify({
          model,
          messages,
          max_tokens,
          temperature,
        })}`,
      );
      completion = await openai.chat.completions
        .create({
          model,
          messages,
          max_tokens,
          temperature,
        })
        .catch((error) => {
          functions.logger.error(`Error sending to OpenAI: ${error}`);
        });
      logTime(start, 'openAiRequest');
      return completion?.choices?.[0]?.message?.content;
    }
  } catch (error) {
    functions.logger.error(`Error sending to OpenAI: ${error}`);
  }
  return 'lol';
};

const extractWhatsAppMessageDetails = (req: {
  body: { entry: { changes: { value: any }[] }[] };
}) => {
  const request = req.body.entry[0].changes[0].value;
  const message = request.messages[0];
  const userId = message.from;
  const messageId = message.id;
  const msgBody = message.text.body;
  const name = request.contacts[0]?.profile.name;
  const phoneNumberId = request.metadata.phone_number_id;
  const msgId = message.id;
  return {
    messageId,
    userId,
    msgBody,
    name,
    phoneNumberId,
    msgId,
  };
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
  const isTylr = userId === tylrId;
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
  if (isTylr) {
    const tylrDB = await database
      .ref(`users/${tylrId}/personality`)
      .once('value');
    const personalitySnapshot = tylrDB.val();
    logLogs(`Personality: ${JSON.stringify(personalitySnapshot)}`);
    const personalityString =
      `This is your personality: ${personalitySnapshot?.personality}` ?? '';

    // Get primer json from notion
    const { system, primer, reminder } = await getPrimer();
    instructions = `${system[0].content} | ${primer[0].content} | ${personalityString} | ${reminder[0].content}`;
    logLogs(`Instructions: ${instructions}`);
    updateAssistant(instructions);
  }
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
  storePersonalityAnalysis(userId, threadMessages);
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
  const run = await openai.beta.threads.runs.create(thread, {
    assistant_id: assistantId ?? '',
    model: 'gpt-4o',
    instructions,
    additional_instructions: customReminder,
  });
  let runStatus = await openai.beta.threads.runs.retrieve(thread, run.id);
  while (runStatus.status !== 'completed') {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    runStatus = await openai.beta.threads.runs.retrieve(thread, run.id);
    if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
      functions.logger.error(`Run status is '${runStatus.status}'. Exiting.`);
      break;
    }
  }
  const messages = await openai.beta.threads.messages.list(thread);
  const lastMessage = messages.data
    .filter(
      (message) => message.run_id === run.id && message.role === 'assistant',
    )
    .pop()?.content[0];
  if (lastMessage?.type === 'text') {
    response = lastMessage?.text.value;
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
