import {
  getPreviousMessages,
  MessageThread,
  sendMessengerMessage,
} from './facebook';
import { logLogs } from './utils';

const AGENT_REQUEST_PHRASES: ReadonlySet<string> = new Set([
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
]);
const AGENT_CONNECT_MESSAGE =
  'I am connecting you with a real agent. Tyler will be with you within 24 hours.';
const MAX_RECENT_MESSAGES_CHECK = 5;

/**
 * Checks if the user's message indicates a need for a human agent on Instagram,
 * considering keywords and recent conversation history.
 * @param message The user's incoming message text.
 * @param userId The user's unique identifier (Instagram PSID).
 * @param requestId The unique identifier for the request.
 * @returns {Promise<boolean>} True if an agent is needed, false otherwise.
 */
export const checkIfNeedAgent = async (
  message: string,
  userId: string,
  requestId: string,
): Promise<boolean> => {
  const lowerCaseMessage = message.toLowerCase();

  const containsAgentPhrase = [...AGENT_REQUEST_PHRASES].some((phrase) =>
    lowerCaseMessage.includes(phrase),
  ); // Closing parenthesis for .some()

  let needsAgent = containsAgentPhrase;
  logLogs(
    `Initial check: Agent needed for user ${userId} based on phrase "${message}"? ${needsAgent}`,
    requestId,
  );

  if (needsAgent) {
    try {
      await sendMessengerMessage(
        userId,
        AGENT_CONNECT_MESSAGE,
        'instagram',
        requestId,
      );
      logLogs(
        `Agent connection message sent to Instagram user ${userId}.`,
        requestId,
      );
    } catch (error) {
      logLogs(
        `Error sending agent connection message to Instagram user ${userId}: ${error}`,
        requestId,
      );
    }
    return true;
  }

  logLogs(
    `No agent phrase detected in "${message}". Checking recent history for Instagram user ${userId}...`,
    requestId,
  );
  try {
    const recentMessages: MessageThread | null = await getPreviousMessages(
      userId,
      MAX_RECENT_MESSAGES_CHECK,
      'instagram', // Platform is implicitly 'instagram' now
      requestId,
    );

    if (recentMessages && recentMessages.length > 0) {
      const alreadyRequested = recentMessages.some(
        (msg) => msg.message === AGENT_CONNECT_MESSAGE,
      );

      if (alreadyRequested) {
        needsAgent = true;
        logLogs(
          `Agent previously requested by Instagram user ${userId} found in recent history.`,
          requestId,
        );
      } else {
        logLogs(
          `No prior agent request found in recent history for Instagram user ${userId}.`,
          requestId,
        );
      }
    } else {
      logLogs(
        `No recent message history found for Instagram user ${userId}.`,
        requestId,
      );
    }
  } catch (error) {
    logLogs(
      `Error fetching recent messages for Instagram user ${userId}: ${error}`,
      requestId,
    );
    return false;
  }

  return needsAgent;
};
