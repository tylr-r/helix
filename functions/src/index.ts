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
const messengerId = process.env.MESSENGER_ID;
const instagramId = process.env.INSTAGRAM_ID;

import OpenAI from 'openai';
const configuration = {
  organization: openAiOrgId,
  apiKey: openaitoken,
};

const openai = new OpenAI(configuration);

admin.initializeApp();

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
const sendMessengerMessage = async (
  userId: string,
  response: string,
  platform: string,
) => {
  functions.logger.log(`Sending ${platform} message to ${userId}`);
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
            role: item.from.id === messengerId ? 'assistant' : 'user',
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
  } else if (platform === 'instagram') {
    functions.logger.log('getting ig messages');
    const igMessages = await facebookGraphRequest(
      `me/conversations?fields=messages.limit(${amount}){created_time,from,message}&user_id=${from}&platform=instagram&`,
      {},
      'Error while getting Instagram messages',
      'GET',
    );
    functions.logger.log(`ig messages: ${JSON.stringify(igMessages?.data)}`);
    const igMessageHistory = igMessages?.data.data[0].messages.data;
    previousMessages = igMessageHistory
      .map(
        (item: {
          from: { name: string; id: string };
          message: string;
          created_time: string;
        }) => {
          return {
            role: item.from.id === instagramId ? 'assistant' : 'user',
            name: item.from.name,
            text: item.message,
            creation: item.created_time,
          };
        },
      )
      .reverse();
    previousMessages = previousMessages.slice(0, previousMessages.length - 1);
    functions.logger.log(
      `ig messages converted: ${JSON.stringify(previousMessages)}`,
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
  imageInterpretation: any,
) => {
  functions.logger.log(
    `previous messages in this func: ${JSON.stringify(messages)}`,
  );
  // Get primer json from notion
  const { system, main, reminder } = await getPrimer();
  const cleanedName = name.replace(/( )/g, '_');
  const latestMessage = imageInterpretation
    ? `I sent you a photo. This is the detailed description: ${imageInterpretation}. Reply as if you saw this image as an image that i sent to you and not as text.`
    : msg_body;

  const previous = messages.map((msg: { role: string; text: any }) => ({
    role: msg.role,
    content: msg.text,
    name: msg.role === 'assistant' ? 'Tylr' : cleanedName,
  }));

  return [
    ...system,
    ...main,
    // Add retrieved messages:
    ...previous,
    { role: 'user', content: `${latestMessage}`, name: cleanedName },
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
      completion = await openai.chat.completions
        .create({
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
      functions.logger.info(`Usage: ${JSON.stringify(completion?.usage)}`);
      const result = completion?.choices[0].message.function_call.arguments;
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
      functions.logger.info(`Usage: ${JSON.stringify(completion?.usage)}`);
      functions.logger.log(completion?.choices?.[0]?.message?.content);
      const end = Date.now();
      functions.logger.log(`openAiRequest took ${end - start} ms`);
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
  attachment: any,
  name: string,
) => {
  functions.logger.log(`Message from ${platform}:  ${msgBody}`);

  functions.logger.log('user info: ' + JSON.stringify(name));

  // Store message if WhatsApp
  if (platform === 'whatsapp') {
    storeMessage(userId, msgBody, 'user');
  }
  const messages = await getPreviousMessages(userId, 15, platform);

  functions.logger.log('previous messages: ' + JSON.stringify(messages));

  const updatedName = platform === 'messenger' ? messages[0].name : name;
  functions.logger.log('updated name: ' + updatedName);
  // Custom Reminder
  const customReminder = `you are talking with ${updatedName} on ${platform} and the current time is ${currentTime}`;
  functions.logger.log('customReminder: ' + customReminder);

  let imageInterpretation;
  // Create messages to AI
  if (attachment) {
    const imageMessage = [
      {
        type: 'text',
        text: ' Describe the contents of the image thoroughly, focusing on the setting, objects, people (noting their actions, expressions, and emotions), colors, and atmosphere. Pay special attention to the context and any text included in the image. Then, if it is a meme, explain the humor by noting cultural references and the contrast that makes it funny.',
      },
      {
        type: 'image_url',
        image_url: attachment ? attachment[0]?.payload?.url : '',
      },
    ];
    imageInterpretation = await openAiRequest(
      [{ role: 'user', content: imageMessage, name: 'someone' }],
      'gpt-4-vision-preview',
      2000,
      1,
    );
  }

  // Create messages to AI
  const messagesToAi = await createMessageToAi(
    messages,
    msgBody,
    customReminder,
    updatedName,
    imageInterpretation,
  );

  const type = attachment ? 'gpt-4-vision-preview' : 'gpt-4-1106-preview';

  logLogs(`${attachment}, ${type}`);

  // Send messages to OpenAI
  functions.logger.log('trying openai request');
  let response = await openAiRequest(
    messagesToAi,
    'gpt-4-1106-preview',
    2000,
    1,
  );
  if (!response) {
    functions.logger.error('Response from openAiRequest was void');
    response = 'Sorry, I am having troubles lol';
  }

  // Store assistant's response to Firestore if WhatsApp
  if (platform === 'whatsapp') {
    storeMessage(userId, response, 'assistant');
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
  let needAgent =
    agentPhrases.some((phrases) => message.includes(phrases)) &&
    platform === 'instagram';
  functions.logger.log(`Need an agent from this message: ${needAgent}`);
  if (needAgent === true) {
    await sendMessengerMessage(
      userId,
      'I am connecting you with a real agent. Tyler will be with you within 24 hours.',
      platform,
    );
  } else {
    const recentMessages = await getPreviousMessages(userId, 5, platform);
    if (recentMessages) {
      const recentMessagesString = JSON.stringify(recentMessages);
      if (
        recentMessagesString.includes('I am connecting you with a real agent')
      ) {
        needAgent = true;
        functions.logger.log(`Recently requested agent`);
      }
    }
  }
  return needAgent;
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
          null,
          name,
        );
        await sendWhatsAppMessage(phoneNumberId, userId, aiResponse);
        return functions.logger.log('Finished WhatsApp function');
      }
      return functions.logger.log('Not a status change or message');
    }

    // Messenger or Instagram
    if (platform === 'page' || platform === 'instagram') {
      functions.logger.log('Processing page request');
      if (platform === 'page') {
        platform = 'messenger';
      }
      const entry = req.body.entry[0];
      if (entry.messaging) {
        const userId = entry.messaging[0].sender.id;
        const msgBody = entry.messaging[0].message.text ?? '';
        const attachment = entry.messaging[0]?.message?.attachments ?? null;
        //const attachmentType = attachment[0]?.type;
        //const attachmentPayload = attachment[0]?.payload.url;
        //const isEcho = entry.messaging[0].message.is_echo;

        logLogs(`Attachment: ${attachment}`);

        /* if (!msgBody || isEcho || attachmentType !== 'image') {
          return functions.logger.log('Not a message');
        } */

        // Check if message is looking for an agent
        const needAgent = await checkIfNeedAgent(msgBody, userId, platform);
        if (needAgent) {
          return functions.logger.log('Agent needed');
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
          attachment,
          'someone',
        );
        await sendMessengerMessage(userId, aiResponse, platform);
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
