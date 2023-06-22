/* eslint-disable @typescript-eslint/no-explicit-any */
import * as functions from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import axios from 'axios';
import { config } from 'dotenv';
import admin from 'firebase-admin';

const openaitoken = process.env.OPENAI_TOKEN;
const openAiOrgId = process.env.OPENAI_ORG_ID;
const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;
const verifyToken = process.env.VERIFY_TOKEN;
const notionToken = process.env.NOTION_TOKEN;
const notionBlockId = process.env.NOTION_BLOCK_ID;

import { Configuration, OpenAIApi } from 'openai';
const configuration = new Configuration({
  organization: openAiOrgId,
  apiKey: openaitoken,
});

const openai = new OpenAIApi(configuration);

admin.initializeApp();

config();

const currentTime = new Date().toLocaleString('en-US', {
  timeZone: 'America/Los_Angeles',
});

const facebookGraphRequest = async (
  endpoint: string,
  data: any,
  errorMsg: string,
) => {
  try {
    return await axios({
      method: 'POST',
      url: `https://graph.facebook.com/v16.0/${endpoint}?access_token=${pageAccessToken}`,
      data,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return functions.logger.error(`${errorMsg}: ${error}`);
  }
};

const getPrimer = async () => {
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
    functions.logger.log('Primer text: ' + primerText);

    let obj;
    try {
      obj = JSON.parse(primerText);
    } catch (error) {
      functions.logger.error(`Error parsing primer text: ${error}`);
    }

    functions.logger.log('Parsed primer text: ' + JSON.stringify(obj));
    return obj;
  } catch (error) {
    functions.logger.error(`Error getting primer: ${error}`);
  }
};

const sendWhatsAppReceipt = async (phone_number_id: string, msgId: string) => {
  await facebookGraphRequest(
    `${phone_number_id}/messages`,
    {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: msgId,
    },
    'Error while marking WhatsApp as seen',
  );
};

// Send Messenger receipt
const sendMessengerReceipt = async (userId: string, sender_action: string) => {
  await facebookGraphRequest(
    'me/messages',
    {
      recipient: { id: userId },
      sender_action,
    },
    `Error while sending Messenger action: ${sender_action}`,
  );
};

// Send Messenger message
const sendMessengerMessage = async (userId: string, response: string) => {
  await facebookGraphRequest(
    'me/messages',
    {
      recipient: { id: userId },
      message: { text: `${response}` },
    },
    'Error while sending Messenger message',
  );
};

// Send WhatsApp message
const sendWhatsAppMessage = async (
  userId: string,
  from: string,
  response: string,
) => {
  functions.logger.log('Sending WhatsApp message');
  await facebookGraphRequest(
    `${userId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: from,
      text: { body: `${response}` },
    },
    'Error while sending WhatsApp message',
  );
};

const storeMessage = async (from: string, message: any, role: string) => {
  try {
    await admin
      .firestore()
      .collection('users')
      .doc(from)
      .collection('conversation')
      .add({
        text: message,
        creation: admin.firestore.FieldValue.serverTimestamp(),
        role,
      });
  } catch (error) {
    functions.logger.error(`Error storing message: ${error}`);
  }
};

// Store message summary
const storeMessageSummary = async (userId: string, message: string) => {
  functions.logger.log('Storing message summary with PaLM');
  try {
    await admin
      .firestore()
      .collection('users')
      .doc(userId)
      .collection('summaries')
      .add({
        text: message,
        userId,
        creation: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (error) {
    functions.logger.error(`Error storing message summary: ${error}`);
  }
};

// Get Message Summary
const getConversationSummary = async (userId: string) => {
  functions.logger.log('Getting message summary');
  try {
    const snapshot = await admin
      .firestore()
      .collection('users')
      .doc(userId)
      .collection('summaries')
      .orderBy('creation', 'asc')
      .limit(1)
      .get();
    functions.logger.log(`Conversation summary: ${snapshot}`);
    /* const cleanedString = JSON.stringify(
    JSON.parse(snapshot.docs[0].data().text),
  );
  functions.logger.log(`Conversation summary: ${cleanedString}`); */
    return snapshot.docs[0].data().text;
  } catch (error) {
    functions.logger.error(`Error getting message summary: ${error}`);
    return '';
  }
};

// Store user info
const storeUserInfo = async (
  userId: string,
  platform: string,
  name: string,
) => {
  functions.logger.debug('Storing user info for' + name);
  try {
    await admin
      .firestore()
      .collection('users')
      .doc(userId)
      .collection('info')
      .add({
        userId,
        platform,
        name,
      });
  } catch (error) {
    functions.logger.error(`Error storing message: ${error}`);
  }
};

const getFbUserInfo = async (userId: string, platform: string) => {
  functions.logger.log(`Getting user info from Facebook for ${userId}`);
  await facebookGraphRequest(
    userId,
    {},
    `Error getting user info from Facebook for ${userId}`,
  )
    .then((response) => {
      functions.logger.log(
        `Response from FB user info: ${JSON.stringify(response?.data)}`,
      );
      let firstName: string;
      let lastName: string;
      let name: string;
      if (platform === 'messenger') {
        firstName = response?.data.first_name
          ? response.data.first_name
          : 'someone';
        lastName = response?.data.last_name || '';
        name = lastName != '' ? firstName + ' ' + lastName : firstName;
        storeUserInfo(userId, platform, name);
      } else {
        firstName = response?.data.name ? response.data.name : 'someone';
        lastName = response?.data.last_name || '';
        name = lastName != '' ? firstName + ' ' + lastName : firstName;
        storeUserInfo(userId, platform, name);
      }
      return {
        psid: userId,
        first_name: firstName,
        last_name: lastName,
        platform,
      };
    })
    .catch((error: any) => {
      functions.logger.error(`Error getting user info from Facebook: ${error}`);
    });
  return {
    psid: userId,
    first_name: 'someone',
    last_name: '',
    platform,
  };
};

const getUserInfo = async (userId: string, platform: string, name: string) => {
  const start = Date.now();
  functions.logger.log('Getting user info');
  const infoCollectionRef = admin
    .firestore()
    .collection('users')
    .doc(userId)
    .collection('info');
  const snapshot = await infoCollectionRef.limit(1).get();
  if (snapshot.docs.length > 0) {
    functions.logger.log('User info found');
    const end = Date.now();
    functions.logger.log(`getUserInfo took ${end - start} ms`);
    return snapshot.docs[0].data();
  } else {
    functions.logger.log('User info not found');
    if (platform === 'messenger') {
      try {
        return await getFbUserInfo(userId, platform);
      } catch (error) {
        functions.logger.error(
          `Error getting user info from Facebook: ${error}`,
        );
      }
    } else if (platform === 'instagram') {
      try {
        return await getFbUserInfo(userId, platform);
      } catch (error) {
        functions.logger.error(
          `Error getting user info from Facebook: ${error}`,
        );
      }
    } else if (platform === 'whatsapp') {
      functions.logger.log('Using default info for WhatsApp');
      storeUserInfo(userId, platform, name);
    }
    return {
      psid: userId,
      platform: platform === 'whatsapp' ? 'whatsapp' : 'unknown',
      first_name: name || 'someone',
    };
  }
};

const getPreviousMessages = async (from: string, amount: number) => {
  functions.logger.log('getting existing messages');
  const snapshot = await admin
    .firestore()
    .collection('users')
    .doc(from)
    .collection('conversation')
    .orderBy('creation', 'desc')
    .limit(amount) // Limit the number of messages returned
    .get();
  return snapshot.docs.map((doc: { data: () => any }) => doc.data()).reverse();
};

const createMessageToAi = async (
  messages: any[],
  msg_body: any,
  customReminder: string,
  name: string,
  summary: string,
) => {
  // Get primer json from notion
  const { system, main, reminder } = await getPrimer();
  const cleanedName = name.replace(/( )/g, '_');
  return [
    ...system,
    ...main,
    // Add retrieved messages:
    ...messages.map((msg: { role: string; text: any }) => ({
      role: msg.role,
      content: msg.text,
      name: msg.role === 'assistant' ? 'Tylr' : cleanedName,
    })),
    { role: 'user', content: `${msg_body}`, name: cleanedName },
    {
      role: 'system',
      content: `Here is a summary of the previous conversation: ${summary}`,
    },
    ...reminder,
    {
      role: 'system',
      content: customReminder,
    },
  ];
};

const openAiRequest = async (
  messages: any[],
  model: string,
  max_tokens?: number,
  temperature?: number,
  function_call?: boolean,
  ai_functions?: any[],
) => {
  functions.logger.log(`Sending to OpenAI: ${JSON.stringify(messages)}`);
  let completion;
  try {
    if (function_call && ai_functions !== undefined) {
      functions.logger.log('Starting function call');
      const name = ai_functions[0].name;
      functions.logger.debug(
        `function call: ${JSON.stringify({
          model: 'gpt-3.5-turbo-0613',
          messages,
          max_tokens,
          temperature,
          function_call: {
            name,
          },
          functions: ai_functions,
        })}`,
      );
      completion = await openai
        .createChatCompletion({
          model: 'gpt-3.5-turbo-0613',
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
      functions.logger.info(
        `Usage: ${JSON.stringify(completion?.data?.usage)}`,
      );
      const result =
        completion?.data?.choices[0].message.function_call.arguments;
      return result;
    } else {
      functions.logger.log('Starting normal call');
      completion = await openai
        .createChatCompletion({
          model,
          messages,
          max_tokens,
          temperature,
        })
        .catch((error) => {
          functions.logger.error(`Error sending to OpenAI: ${error}`);
        });
      functions.logger.info(
        `Usage: ${JSON.stringify(completion?.data?.usage)}`,
      );
      functions.logger.log(completion?.data?.choices?.[0]?.message?.content);
      return completion?.data?.choices?.[0]?.message?.content;
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
  const msgBody = message.text.body;
  const name = request.contacts[0]?.profile.name;
  const phoneNumberId = request.metadata.phone_number_id;
  const msgId = message.id;

  functions.logger.log(`Whatsapp request: ${JSON.stringify(request)}`);

  return {
    userId,
    msgBody,
    name,
    phoneNumberId,
    msgId,
  };
};

const processMessage = async (
  userId: string,
  msgBody: string,
  platform: string,
  name: string,
) => {
  functions.logger.log(`Message from ${platform}:  ${msgBody}`);

  // Check if user exists in firestore
  const userInfo = await getUserInfo(userId, platform, name);
  const summary = await getConversationSummary(userId);

  functions.logger.log('user info: ' + JSON.stringify(name));

  storeMessage(userId, msgBody, 'user');
  const messages = await getPreviousMessages(userId, 5);

  functions.logger.log('previous messages: ' + JSON.stringify(messages));

  // Check to see if AI needs to know it's own history
  const needHistory = await openAiRequest(
    [
      {
        role: 'system',
        content: 'You are Tylr, a real human.',
      },
      {
        role: 'user',
        content: `Does a response to the following message benefit if you know your personal experiences or stored memories: "${msgBody}"?`,
      },
    ],
    'gpt-3.5-turbo-0613',
    600,
    0.5,
    true,
    [
      {
        name: 'history_need',
        description:
          "Determine if the Tylr's history or background information is necessary to formulate a substantial response to the user's message.",
        parameters: {
          type: 'object',
          properties: {
            need_history: {
              type: 'boolean',
              description: 'a true or false',
            },
          },
          required: ['need_history'],
        },
      },
    ],
  );

  functions.logger.log(
    `needHistory: ${JSON.stringify(JSON.parse(needHistory))}`,
  );

  // Custom Reminder
  const customReminder = `you are talking with ${userInfo.first_name} on ${platform} and the current time is ${currentTime}`;
  functions.logger.log('customReminder: ' + customReminder);

  // Get conversation summary
  // const conversationSummary = await getConversationSummary(messages);
  const bigMessageSummary = await getPreviousMessages(userId, 25);
  const bigMessageSummaryCleaned = JSON.stringify(
    bigMessageSummary.map((msg: { role: string; text: string }) => ({
      name: msg.role === 'assistant' ? 'Tylr' : userInfo.first_name,
      content: msg.text,
    })),
  )
    .replace(/user/g, name)
    .replace(/assistant/g, 'Tylr');

  storeMessageSummary(userId, bigMessageSummaryCleaned);

  // Create messages to AI
  const messagesToAi = await createMessageToAi(
    messages,
    msgBody,
    customReminder,
    name,
    summary,
  );

  // Send messages to OpenAI
  functions.logger.log('trying openai request');
  const response = await openAiRequest(messagesToAi, 'gpt-4', 500, 1);
  if (!response) {
    throw new Error('Response from openAiRequest was void');
  }

  // Store assistant's response to Firestore
  storeMessage(userId, response, 'assistant');
  return response;
};

const app = async (req, res) => {
  const startTime = new Date();
  functions.logger.log('running app function!');

  functions.logger.info(JSON.stringify(req.body));

  // Webhook verification
  if (req.method === 'GET') {
    functions.logger.log('Processing GET request');
    functions.logger.info(req, { structuredData: true });

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        functions.logger.log('WEBHOOK_VERIFIED');
        return res.status(200).send(challenge);
      }
      return res.sendStatus(403);
    }
    return res.sendStatus(404);
  }

  if (req.method === 'POST') {
    res.sendStatus(200);
    functions.logger.log('Processing POST request');

    let platform = req.body.object;

    // WhatsApp
    if (platform === 'whatsapp_business_account') {
      platform = 'whatsapp';
      functions.logger.log('Processing whatsapp request');
      if (
        req.body.entry &&
        req.body.entry[0].changes &&
        req.body.entry[0].changes[0] &&
        req.body.entry[0].changes[0].value &&
        req.body.entry[0].changes[0].value.status
      ) {
        return functions.logger.log('Status change');
      } else if (
        req.body.entry &&
        req.body.entry[0].changes &&
        req.body.entry[0].changes[0] &&
        req.body.entry[0].changes[0].value.messages &&
        req.body.entry[0].changes[0].value.messages[0]
      ) {
        const { userId, msgBody, name, phoneNumberId, msgId } =
          extractWhatsAppMessageDetails(req);
        sendWhatsAppReceipt(phoneNumberId, msgId);
        const aiResponse = await processMessage(
          userId,
          msgBody,
          platform,
          name,
        );
        await sendWhatsAppMessage(phoneNumberId, userId, aiResponse);
        return functions.logger.log('Finished WhatsApp function');
      }
      return functions.logger.log('Not a status change or message');
    }

    // Messenger
    if (platform === 'page' || platform === 'instagram') {
      functions.logger.log('Processing page request');
      if (platform === 'page') {
        platform = 'messenger';
      }
      const entry = req.body.entry[0];
      if (entry.messaging) {
        const userId = entry.messaging[0].sender.id;
        const msgBody = entry.messaging[0].message.text;

        if (!msgBody) {
          return functions.logger.log('Not a message');
        }

        // Mark message as seen
        await sendMessengerReceipt(userId, 'mark_seen');
        sendMessengerReceipt(userId, 'typing_on');

        const aiResponse = await processMessage(
          userId,
          msgBody,
          platform,
          'someone',
        );
        await sendMessengerMessage(userId, aiResponse);
        const endTime = new Date();
        const timeDiff = endTime.getTime() - startTime.getTime();
        functions.logger.log('Whole function time: ' + timeDiff);
        return functions.logger.debug('Finished Messenger function');
      }
      return functions.logger.log('Not a message');
    }
    return res.sendStatus(404).send();
  }

  return functions.logger.log('Running for no reason...');
};

export const webhook = onRequest(app);
