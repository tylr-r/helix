import * as functions from 'firebase-functions/v2';
import { ResponseInputMessageContentList } from 'openai/resources/responses/responses';
import { checkIfNeedAgent } from './agentHandler';
import {
  getPersonality,
  getStoredInfo,
  updateLastThreadId,
  updatePersonality,
} from './database';
import {
  PlatformType,
  extractWhatsAppMessageDetails,
  sendMessengerMessage,
  sendMessengerReceipt,
  sendWhatsAppMessage,
  sendWhatsAppReceipt,
} from './facebook';
import { openAiResponsesRequest, updateAssistant } from './openai';
import { getPersonalityAnalysis } from './personality';
import {
  getHumanReadableDate,
  logLogs,
  logTime,
  logs,
  timeLogs,
} from './utils';

const verifyToken = process.env.VERIFY_TOKEN;
const notionToken = process.env.NOTION_TOKEN;
const notionBlockId = process.env.NOTION_BLOCK_ID;
const assistantId = process.env.ASSISTANT_ID;

const getPrimer = async () => {
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

const processMessage = async (
  messageId: string,
  userId: string,
  msgBody: string,
  platform: PlatformType,
  attachment: any,
  name: string,
  lastThreadId: string | null,
) => {
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

const app = async (req, res) => {
  const startTime = Date.now();
  logLogs('running app function!');
  functions.logger.info(JSON.stringify(req.body));
  // Webhook verification
  if (req.method === 'GET') {
    logLogs('Processing GET request');
    functions.logger.info('Request body:', JSON.stringify(req.body));

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
    let platform: PlatformType;

    switch (req.body.object) {
      case 'whatsapp_business_account':
        platform = 'whatsapp';
        break;
      case 'page':
        platform = 'messenger';
        break;
      case 'instagram':
        platform = 'instagram';
        break;
      default:
        platform = req.body.object as PlatformType;
    }
    // WhatsApp
    if (platform === 'whatsapp') {
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
        // Get user info
        const userInfo = await getStoredInfo(userId, platform);
        const aiResponse = await processMessage(
          messageId,
          userId,
          msgBody,
          platform,
          null,
          name,
          userInfo.thread.id ?? null,
        );
        await sendWhatsAppMessage(phoneNumberId, userId, aiResponse);
        return logLogs('Finished WhatsApp function');
      }
      return logLogs('Not a status change or message');
    }
    // Messenger or Instagram
    logLogs('Processing page request');
    const entry = req.body.entry[0];
    if (entry.messaging) {
      const userId = entry.messaging[0].sender.id;
      const messageId = entry.messaging[0].message.mid ?? '';
      const msgBody = entry.messaging[0].message.text ?? '';
      const attachment = entry.messaging[0]?.message?.attachments ?? null;
      // Mark message as seen if Messenger
      if (platform === 'messenger') {
        // Run marking as seen and typing indicator asynchronously
        (async () => {
          try {
            // Wait 3 seconds before marking as seen
            await new Promise((resolve) => setTimeout(resolve, 3000));
            await sendMessengerReceipt(userId, 'mark_seen');

            // Wait 5 seconds before showing typing indicator
            await new Promise((resolve) => setTimeout(resolve, 5000));
            await sendMessengerReceipt(userId, 'typing_on');
          } catch (error) {
            functions.logger.error(
              `Error sending Messenger receipts: ${error}`,
            );
            // Continue execution even if receipts fail
          }
        })();
      }
      // Get user info
      const userInfo = await getStoredInfo(userId, platform);
      const lastThreadId: string | null = userInfo.thread.id;
      const name = userInfo.userName ?? 'someone';
      // Check if message is looking for an agent (only for Instagram)
      let needAgent = false;
      if (platform === 'instagram') {
        needAgent = await checkIfNeedAgent(msgBody, userId);
      }
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
        lastThreadId,
      );
      if (platform === 'messenger') {
        await sendMessengerReceipt(userId, 'typing_off');
      }
      await sendMessengerMessage(userId, aiResponse, platform);
      logTime(startTime, 'Whole function time:');
      functions.logger.log(logs);
      functions.logger.log(timeLogs);
      return functions.logger.log('Finished Messenger function');
    }
    return logLogs('Not a message');
  }
  return logLogs('Running for no reason...');
};

export const webhook = functions.https.onRequest(app);
