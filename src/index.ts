import * as functions from 'firebase-functions/v2';
import { checkIfNeedAgent } from './agentHandler';
import { getStoredInfo } from './database';
import {
  PlatformType,
  sendMessengerMessage,
  sendMessengerReceipt,
} from './facebook';
import { processMessage } from './processMessage';
import {
  clearLogs,
  clearTimeLogs,
  getLogs,
  getTimeLogs,
  logLogs,
  logTime,
} from './utils';
import { handleWhatsAppWebhook } from './whatsappHandler';

const verifyToken = process.env.VERIFY_TOKEN;

const app = async (req, res) => {
  const startTime = Date.now();
  // Generate a unique requestId for this invocation
  const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  logLogs('running app function!', requestId);
  functions.logger.info(JSON.stringify(req.body));
  // Webhook verification
  if (req.method === 'GET') {
    logLogs('Processing GET request', requestId);
    functions.logger.info('Request body:', JSON.stringify(req.body));

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === verifyToken) {
        logLogs('WEBHOOK_VERIFIED', requestId);
        return res.status(200).send(challenge);
      }
      return res.sendStatus(403);
    }
    return res.sendStatus(404);
  }
  if (req.method === 'POST') {
    res.sendStatus(200);
    logLogs('Processing POST request', requestId);
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
      logLogs('Processing whatsapp request', requestId);
      return await handleWhatsAppWebhook(req, requestId);
    }
    // Messenger or Instagram
    logLogs('Processing page request', requestId);
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
            // await new Promise((resolve) => setTimeout(resolve, 3000));
            await sendMessengerReceipt(userId, 'mark_seen', requestId);

            // Wait 5 seconds before showing typing indicator
            // await new Promise((resolve) => setTimeout(resolve, 5000));
            await sendMessengerReceipt(userId, 'typing_on', requestId);
          } catch (error) {
            functions.logger.error(
              `Error sending Messenger receipts: ${error}`,
            );
            // Continue execution even if receipts fail
          }
        })();
      }
      // Get user info
      const userInfo = await getStoredInfo(userId, platform, requestId);
      const lastThreadId: string | null = userInfo.thread.id;
      const name = userInfo.userName ?? 'someone';
      // Check if message is looking for an agent (only for Instagram)
      let needAgent = false;
      if (platform === 'instagram') {
        needAgent = await checkIfNeedAgent(msgBody, userId, requestId);
      }
      if (needAgent) {
        return logLogs('Agent needed', requestId);
      }
      const aiResponse = await processMessage(
        messageId,
        userId,
        msgBody,
        platform,
        attachment,
        name,
        lastThreadId,
        requestId,
      );
      if (platform === 'messenger') {
        await sendMessengerReceipt(userId, 'typing_off', requestId);
      }
      await sendMessengerMessage(userId, aiResponse, platform, requestId);
      await logTime(startTime, 'Whole function time:', requestId);
      functions.logger.log(getLogs(requestId));
      functions.logger.log(getTimeLogs(requestId));
      clearLogs(requestId);
      clearTimeLogs(requestId);
      return functions.logger.log('Finished Messenger function');
    }
    return logLogs('Not a message', requestId);
  }
  return logLogs('Running for no reason...', requestId);
};

export const webhook = functions.https.onRequest(app);
