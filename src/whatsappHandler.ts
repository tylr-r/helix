import { getStoredInfo } from './database';
import {
  extractWhatsAppMessageDetails,
  sendWhatsAppMessage,
  sendWhatsAppReceipt,
} from './facebook';
import { processMessage } from './processMessage';
import { logLogs } from './utils';

export const handleWhatsAppWebhook = async (req: any, requestId: string) => {
  if (
    req.body.entry &&
    req.body.entry[0].changes &&
    req.body.entry[0].changes[0] &&
    req.body.entry[0].changes[0].value &&
    req.body.entry[0].changes[0].value.status
  ) {
    return logLogs('Status change', requestId);
  } else if (
    req.body.entry &&
    req.body.entry[0].changes &&
    req.body.entry[0].changes[0] &&
    req.body.entry[0].changes[0].value.messages &&
    req.body.entry[0].changes[0].value.messages[0]
  ) {
    const { messageId, userId, msgBody, name, phoneNumberId, msgId } =
      extractWhatsAppMessageDetails(req);
    sendWhatsAppReceipt(phoneNumberId, msgId, requestId);
    // Get user info
    const userInfo = await getStoredInfo(userId, 'whatsapp', requestId);
    const response = await processMessage(
      messageId,
      userId,
      msgBody,
      'whatsapp',
      null,
      name,
      userInfo.thread.id ?? null,
      requestId,
    );
    await sendWhatsAppMessage(phoneNumberId, userId, response, requestId);
    return logLogs('Finished WhatsApp function', requestId);
  }
  return logLogs('Not a status change or message', requestId);
};
