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

// aggregate logs together
const logs: string[] = [];
const logLogs = (log: string) => {
  functions.logger.log(log);
  logs.push(log);
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
  const start = new Date();
  try {
    const response = await axios({
      method,
      url: `https://graph.facebook.com/v16.0/${endpoint}access_token=${pageAccessToken}`,
      data,
      headers: { 'Content-Type': 'application/json' },
    });
    const end = new Date();
    logLogs(
      `Time to send FB Graph Request: ${end.getTime() - start.getTime()}ms`,
    );
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
  const start = new Date();
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
    const end = new Date();
    logLogs(`Time to get primer: ${end.getTime() - start.getTime()}ms`);
    return obj;
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
const sendMessengerMessage = async (userId: string, response: string) => {
  await facebookGraphRequest(
    'me/messages?',
    {
      recipient: { id: userId },
      message: { text: `${response}` },
    },
    'Error while sending Messenger message',
    'POST',
  );
};

// Send WhatsApp message
const sendWhatsAppMessage = async (
  phoneNumberId: string,
  userId: string,
  response: string,
) => {
  functions.logger.log('Sending WhatsApp message');
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

const storeMessage = async (from: string, message: any, role: string) => {
  functions.logger.log('Storing message with in Firestore');
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
// const storeMessageSummary = async (userId: string, message: string) => {
//   functions.logger.log('Storing message summary with PaLM');
//   try {
//     await admin
//       .firestore()
//       .collection('users')
//       .doc(userId)
//       .collection('summaries')
//       .add({
//         text: message,
//         userId,
//         creation: admin.firestore.FieldValue.serverTimestamp(),
//       });
//   } catch (error) {
//     functions.logger.error(`Error storing message summary: ${error}`);
//   }
// };

// Get Message Summary
// const getConversationSummary = async (userId: string) => {
//   functions.logger.log('Getting message summary');
//   const start = new Date();
//   try {
//     const snapshot = await admin
//       .firestore()
//       .collection('users')
//       .doc(userId)
//       .collection('summaries')
//       .orderBy('creation', 'asc')
//       .limit(1)
//       .get();
//     functions.logger.log(`Conversation summary: ${snapshot}`);
//     /* const cleanedString = JSON.stringify(
//     JSON.parse(snapshot.docs[0].data().text),
//   );
//   functions.logger.log(`Conversation summary: ${cleanedString}`); */
//     const end = new Date();
//     logLogs(`Time to get summary: ${end.getTime() - start.getTime()}ms`);
//     return snapshot.docs[0].data().text;
//   } catch (error) {
//     functions.logger.error(`Error getting message summary: ${error}`);
//     return '';
//   }
// };

// Store user info
// const storeUserInfo = async (
//   userId: string,
//   platform: string,
//   name: string,
// ) => {
//   functions.logger.debug('Storing user info for' + name);
//   try {
//     await admin
//       .firestore()
//       .collection('users')
//       .doc(userId)
//       .collection('info')
//       .add({
//         userId,
//         platform,
//         name,
//       });
//   } catch (error) {
//     functions.logger.error(`Error storing message: ${error}`);
//   }
// };

const getPreviousMessages = async (
  from: string,
  amount: number,
  platform: string,
) => {
  const start = Date.now();
  functions.logger.log('getting existing messages');
  let previousMessages: any;
  if (platform === 'messenger') {
    functions.logger.log('getting fb messages');
    const fbMessages = await facebookGraphRequest(
      `me/conversations?fields=messages.limit(${amount}){created_time,from,message}&user_id=${from}&`,
      {},
      'Error while getting Messenger messages',
      'GET',
    );
    functions.logger.log(`fb messages: ${JSON.stringify(fbMessages?.data)}`);
    const fbMessageHistory = fbMessages?.data.data[0].messages.data;
    previousMessages = fbMessageHistory
      .map(
        (item: {
          from: { name: string; id: string };
          message: string;
          created_time: string;
        }) => {
          return {
            role: item.from.id === '278067462233855' ? 'assistant' : 'user',
            name: item.from.name,
            text: item.message,
            creation: item.created_time,
          };
        },
      )
      .reverse();
    previousMessages = previousMessages.slice(0, previousMessages.length - 1);
    functions.logger.log(
      `fb messages converted: ${JSON.stringify(previousMessages)}`,
    );
  } else {
    functions.logger.log('getting firestore messages');
    const snapshot = await admin
      .firestore()
      .collection('users')
      .doc(from)
      .collection('conversation')
      .orderBy('creation', 'desc')
      .limit(amount) // Limit the number of messages returned
      .get();
    previousMessages = snapshot.docs
      .map((doc: { data: () => any }) => doc.data())
      .reverse();
    functions.logger.log(
      `Previous messages: ${JSON.stringify(previousMessages)}`,
    );
  }
  const end = Date.now();
  functions.logger.log(`getPreviousMessages took ${end - start} ms`);
  return previousMessages;
};

const createMessageToAi = async (
  messages: any[],
  msg_body: any,
  customReminder: string,
  name: string,
  //summary?: string,
) => {
  functions.logger.log(
    `previous messages in this func: ${JSON.stringify(messages)}`,
  );
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
    /* {
      role: 'system',
      content: `Here is a summary of the previous conversation: ${summary}`,
    }, */
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
  const start = Date.now();
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
      functions.logger.log(`Result: ${JSON.stringify(result)}`);
      const end = Date.now();
      functions.logger.log(`openAiRequest took ${end - start} ms`);
      return result;
    } else {
      functions.logger.log('Starting normal call');
      functions.logger.debug(
        `normal call: ${JSON.stringify({
          model,
          messages,
          max_tokens,
          temperature,
        })}`,
      );
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
      const end = Date.now();
      functions.logger.log(`openAiRequest took ${end - start} ms`);
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

  functions.logger.log('user info: ' + JSON.stringify(name));

  storeMessage(userId, msgBody, 'user');
  const messages = await getPreviousMessages(userId, 15, platform);

  functions.logger.log('previous messages: ' + JSON.stringify(messages));

  const updatedName = platform === 'messenger' ? messages[0].name : name;
  functions.logger.log('updated name: ' + updatedName);
  // Custom Reminder
  const customReminder = `you are talking with ${updatedName} on ${platform} and the current time is ${currentTime}`;
  functions.logger.log('customReminder: ' + customReminder);

  // Get conversation summary
  // const conversationSummary = await getConversationSummary(messages);
  // const bigMessageSummary = await getPreviousMessages(userId, 25);
  // const bigMessageSummaryCleaned = JSON.stringify(
  //   bigMessageSummary.map((msg: { role: string; text: string }) => ({
  //     name: msg.role === 'assistant' ? 'Tylr' : userInfo.first_name,
  //     content: msg.text,
  //   })),
  // )
  //   .replace(/user/g, name)
  //   .replace(/assistant/g, 'Tylr');

  //storeMessageSummary(userId, bigMessageSummaryCleaned);

  // Create messages to AI
  const messagesToAi = await createMessageToAi(
    messages,
    msgBody,
    customReminder,
    updatedName,
    //summary,
  );

  // Send messages to OpenAI
  functions.logger.log('trying openai request');
  let response = await openAiRequest(messagesToAi, 'gpt-4', 2000, 1);
  if (!response) {
    functions.logger.error('Response from openAiRequest was void');
    response = 'Sorry, I am having troubles lol';
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
        const isEcho = entry.messaging[0].message.is_echo;

        if (!msgBody || isEcho) {
          return functions.logger.log('Not a message');
        }

        // Mark message as seen if Messenger
        if (platform === 'messenger') {
          await sendMessengerReceipt(userId, 'mark_seen');
          sendMessengerReceipt(userId, 'typing_on');
        }

        const aiResponse = await processMessage(
          userId,
          msgBody,
          platform,
          'someone',
        );
        await sendMessengerMessage(userId, aiResponse);
        const endTime = new Date();
        logLogs(
          `Whole function time: ${endTime.getTime() - startTime.getTime()}`,
        );
        functions.logger.log(logs);
        return functions.logger.debug('Finished Messenger function');
      }
      return functions.logger.log('Not a message');
    }
    return res.sendStatus(404).send();
  }

  return functions.logger.log('Running for no reason...');
};

export const webhook = onRequest(app);
