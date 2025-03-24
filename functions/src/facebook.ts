/* eslint-disable @typescript-eslint/no-explicit-any */
import * as functions from 'firebase-functions';
import axios from 'axios';
import { logLogs, logTime } from './utils';

// Get environment variable for Facebook
const pageAccessToken = process.env.PAGE_ACCESS_TOKEN;

export const facebookGraphRequest = async (
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

// Send WhatsApp receipt
export const sendWhatsAppReceipt = async (
  phone_number_id: string,
  msgId: string,
) => {
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
export const sendMessengerReceipt = async (
  userId: string,
  sender_action: string,
) => {
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
export const sendMessengerMessage = async (
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
export const sendWhatsAppMessage = async (
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
