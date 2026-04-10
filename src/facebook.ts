import * as functions from 'firebase-functions/v2';
import { logLogs, logTime, maskIdentifier } from './utils';

export type PlatformType = 'messenger' | 'instagram' | 'whatsapp';

export type MessageThread = {
  from: {
    name: string;
    id: string;
  };
  message: string;
  created_time: string;
  id: string;
}[];

// Get environment variable for Facebook
const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;

export const facebookGraphRequest = async (
  endpoint: string,
  data: any,
  errorMsg: string,
  method: string,
) => {
  try {
    if (!pageAccessToken) {
      throw new Error('PAGE_ACCESS_TOKEN is not configured');
    }

    const url = new URL(
      `https://graph.facebook.com/v22.0/${endpoint.replace(/^\//, '')}`,
    );

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: method !== 'GET' ? JSON.stringify(data) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Facebook Graph API request failed with status ${response.status}: ${errorText}`,
      );
    }
    return await response.json();
  } catch (error: any) {
    functions.logger.error(
      `Error in Facebook Graph API request ${endpoint}: ${error}`,
    );
  }
};

// Get user name from either Messenger or Instagram
export const getUserName = async (
  userId: string,
  platform: PlatformType,
  requestId: string,
): Promise<string> => {
  logLogs(
    `Getting user name for ${platform} user ${maskIdentifier(userId)}`,
    requestId,
  );
  const start = Date.now();
  const isMessenger = platform === 'messenger';
  const endpoint = isMessenger
    ? `me/conversations?fields=senders&user_id=${userId}&`
    : `me/conversations?fields=name&platform=instagram&user_id=${userId}&`;
  const userInfo = await facebookGraphRequest(
    endpoint,
    {},
    `Error while getting user name for ${platform}`,
    'GET',
  );
  logTime(start, 'getUserName', requestId);
  const name = isMessenger
    ? userInfo?.data[0].senders.data[0].name
    : userInfo?.data[0].name;
  return name;
};

export const getPreviousMessages = async (
  userId: string,
  limit: number,
  platform: PlatformType,
  requestId: string,
): Promise<MessageThread> => {
  const start = Date.now();
  logLogs(
    `Getting previous messages for ${platform} userId: ${userId}`,
    requestId,
  );
  const endpoint =
    platform === 'messenger'
      ? `me/conversations?fields=messages.limit(${limit}){from,message,created_time}&user_id=${userId}&`
      : `me/conversations?fields=messages.limit(${limit}){from,message,created_time}&platform=instagram&user_id=${userId}&`;

  const response = await facebookGraphRequest(
    endpoint,
    {},
    `Error while getting previous messages for ${platform}`,
    'GET',
  );

  const messageThread = response?.data[0].messages.data as MessageThread;
  logLogs(`Retrieved ${messageThread?.length ?? 0} previous messages`, requestId);
  logTime(start, 'getPreviousMessages', requestId);
  return messageThread;
};

// Send WhatsApp receipt
export const sendWhatsAppReceipt = async (
  phone_number_id: string,
  msgId: string,
  requestId: string,
) => {
  logLogs(
    `Sending WhatsApp read receipt for message ${maskIdentifier(msgId)}`,
    requestId,
  );
  const start = Date.now();
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
  logTime(start, 'sendWhatsAppReceipt', requestId);
};

// Send Messenger receipt
export const sendMessengerReceipt = async (
  userId: string,
  sender_action: string,
  requestId: string,
) => {
  logLogs(
    `Sending Messenger receipt to ${maskIdentifier(userId)} with action: ${sender_action}`,
    requestId,
  );
  const start = Date.now();
  await facebookGraphRequest(
    'me/messages?',
    {
      recipient: { id: userId },
      sender_action,
    },
    `Error while sending Messenger action: ${sender_action}`,
    'POST',
  );
  logTime(start, 'sendMessengerReceipt', requestId);
};

// Send Messenger message
export const sendMessengerMessage = async (
  userId: string,
  response: string,
  platform: string,
  requestId: string,
) => {
  logLogs(
    `Sending ${platform} message to ${maskIdentifier(userId)}`,
    requestId,
  );
  const start = Date.now();
  await facebookGraphRequest(
    'me/messages?',
    {
      recipient: { id: userId },
      message: { text: `${response}` },
    },
    `Error while sending ${platform} message`,
    'POST',
  );
  logTime(start, 'sendMessengerMessage', requestId);
};

// Send WhatsApp message
export const sendWhatsAppMessage = async (
  phoneNumberId: string,
  userId: string,
  response: string,
  requestId: string,
) => {
  logLogs('Sending WhatsApp message', requestId);
  const start = Date.now();
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
  logTime(start, 'sendWhatsAppMessage', requestId);
};

// Extract WhatsApp message details from request
export const extractWhatsAppMessageDetails = (req: {
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
