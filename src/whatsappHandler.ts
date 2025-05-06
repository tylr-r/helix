import { getStoredInfo } from './database';
import {
  extractWhatsAppMessageDetails,
  sendWhatsAppMessage,
  sendWhatsAppReceipt,
} from './facebook';
import { processMessage } from './processMessage';
import { logLogs } from './utils';

export const handleWhatsAppWebhook = async (req: any) => {
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
    const userInfo = await getStoredInfo(userId, 'whatsapp');
    const aiResponse = await processMessage(
      messageId,
      userId,
      msgBody,
      'whatsapp',
      null,
      name,
      userInfo.thread.id ?? null,
    );
    await sendWhatsAppMessage(phoneNumberId, userId, aiResponse);
    return logLogs('Finished WhatsApp function');
  }
  return logLogs('Not a status change or message');
};
