/* eslint-disable @typescript-eslint/no-explicit-any */
import * as functions from 'firebase-functions';
import OpenAI from 'openai';
import { logLogs, logTime } from './utils';
import { ResponseInput, Tool } from 'openai/resources/responses/responses';

// Get environment variables for OpenAI
const openaitoken = process.env.OPENAI_API_KEY ?? '';
const openAiOrgId = process.env.OPENAI_ORG_ID;

// Configure OpenAI client
const configuration = {
  organization: openAiOrgId,
  apiKey: openaitoken,
};

type Metadata = {
  userId: string;
  name: string;
  platform: string;
};

const openai = new OpenAI(configuration);

export const openAiRequest = async (
  messages: any[],
  model: string,
  max_tokens?: number,
  temperature?: number,
  function_call?: boolean,
  ai_functions?: any[],
) => {
  const start = Date.now();
  let completion;
  try {
    if (function_call && ai_functions !== undefined) {
      logLogs('Starting openai function call');
      const name = ai_functions[0].name;
      completion = await openai.chat.completions
        .create({
          model: 'gpt-4.5-preview',
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
      await logTime(start, 'openAiRequest');
      return result;
    } else {
      logLogs('Starting normal openai call');
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
      await logTime(start, 'openAiRequest');
      return completion?.choices?.[0]?.message?.content;
    }
  } catch (error) {
    functions.logger.error(`Error sending to OpenAI: ${error}`);
  }
  return 'lol';
};

export const openAiResponsesRequest = async (
  input: ResponseInput,
  model = 'gpt-4o',
  max_output_tokens = 2048,
  temperature = 1,
  web_search = false,
) => {
  const start = Date.now();
  try {
    logLogs('Starting openai responses API call');
    functions.logger.debug(
      `responses call: ${JSON.stringify({
        model,
        input,
        max_output_tokens,
        temperature,
        web_search,
      })}`,
    );
    const webSearchConfig: Array<Tool> = [
      {
        type: 'web_search_preview',
        user_location: {
          type: 'approximate',
          country: 'US',
          region: 'WA',
        },
        search_context_size: 'medium',
      },
    ];
    const tools = web_search ? webSearchConfig : undefined;
    const response = await openai.responses
      .create({
        model,
        input,
        text: {
          format: {
            type: 'text',
          },
        },
        tools,
        temperature,
        max_output_tokens,
        top_p: 1,
      })
      .catch((error) => {
        functions.logger.error(
          `Error sending to OpenAI Responses API: ${error}`,
        );
      });

    await logTime(start, 'openAiResponsesRequest');
    return response;
  } catch (error) {
    functions.logger.error(`Error sending to OpenAI Responses API: ${error}`);
  }
  return 'Error in responses API';
};

interface RunOptions {
  assistant_id: string;
  model: string;
  additional_instructions?: string;
  instructions?: string; // Optional property
}

export const updateAssistant = async (
  instructions: string,
  assistantId: string,
) => {
  const start = Date.now();
  logLogs('Updating assistant');
  try {
    const res = await openai.beta.assistants.update(assistantId, {
      instructions,
    });
    logTime(start, 'updateAssistant');
    logLogs(`Assistant updated: ${JSON.stringify(res)}`);
    return res;
  } catch (error) {
    functions.logger.error(`Error updating assistant: ${error}`);
    return null;
  }
};

export const createThreadMessage = async (
  threadId: string,
  userMessage: string,
  messageId: string,
) => {
  try {
    return await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: userMessage,
      metadata: {
        messageId,
      },
    });
  } catch (error) {
    functions.logger.error(`Error creating thread message: ${error}`);
    return null;
  }
};

export const listThreadMessages = async (threadId: string) => {
  try {
    return await openai.beta.threads.messages.list(threadId);
  } catch (error) {
    functions.logger.error(`Error listing thread messages: ${error}`);
    return null;
  }
};

export const processThreadRun = async (
  model: string,
  threadId: string,
  assistantId: string,
  instructions: string,
  customInstructions?: string,
) => {
  try {
    const runOptions: RunOptions = {
      assistant_id: assistantId,
      model,
      instructions,
    };

    if (customInstructions) {
      runOptions.additional_instructions = customInstructions;
    }

    const run = await openai.beta.threads.runs.createAndPoll(
      threadId,
      runOptions,
    );

    let runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    let retryCount = 0;
    const maxRetries = 3;
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();

    while (runStatus.status !== 'completed') {
      logLogs(`Run status: ${runStatus.status}`);

      // Check if we've exceeded max wait time
      if (Date.now() - startTime > maxWaitTime) {
        throw new Error('Run timed out after 30 seconds');
      }

      // Handle error states
      if (['failed', 'cancelled', 'expired'].includes(runStatus.status)) {
        const errorDetails = {
          status: runStatus.status,
          error: runStatus.last_error?.message || 'Unknown error',
          code: runStatus.last_error?.code || 'NO_CODE',
          timestamp: new Date().toISOString(),
        };

        functions.logger.error('Run failed:', errorDetails);

        // If we haven't exceeded max retries, try again
        if (retryCount < maxRetries) {
          logLogs(`Retrying run (attempt ${retryCount + 1}/${maxRetries})`);
          retryCount++;

          // Create a new run
          const newRun = await openai.beta.threads.runs.createAndPoll(
            threadId,
            {
              assistant_id: assistantId,
            },
          );
          runStatus = await openai.beta.threads.runs.retrieve(
            threadId,
            newRun.id,
          );
          continue;
        }

        throw new Error(
          `Run failed after ${maxRetries} retries: ${errorDetails.error}`,
        );
      }

      // Wait before checking status again
      await new Promise((resolve) => setTimeout(resolve, 2000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    const messages = await openai.beta.threads.messages.list(threadId);
    const lastMessage = messages.data
      .filter(
        (message) => message.run_id === run.id && message.role === 'assistant',
      )
      .pop()?.content[0];

    if (lastMessage?.type === 'text') {
      return lastMessage.text.value;
    } else {
      throw new Error('No valid response message found');
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    functions.logger.error('Error in processThreadRun:', errorMessage);
    return null;
  }
};

export const createThread = async (metadata: Metadata) => {
  try {
    return await openai.beta.threads.create({
      metadata,
    });
  } catch (error) {
    functions.logger.error(`Error creating thread: ${error}`);
    return null;
  }
};
