import * as functions from 'firebase-functions/v2';
import OpenAI from 'openai';
import { ResponseInput, Tool } from 'openai/resources/responses/responses';
import { logLogs, logTime } from './utils';

// Get environment variables for OpenAI
const openaitoken = process.env.OPENAI_API_KEY ?? '';
const openAiOrgId = process.env.OPENAI_ORG_ID;

// Configure OpenAI client
const configuration = {
  organization: openAiOrgId,
  apiKey: openaitoken,
};

const openai = new OpenAI(configuration);

export const openAiRequest = async (
  messages: any[],
  model: string,
  requestId: string,
  max_tokens?: number,
  temperature?: number,
  function_call?: boolean,
  ai_functions?: any[],
) => {
  const start = Date.now();
  let completion;
  try {
    if (function_call && ai_functions !== undefined) {
      logLogs('Starting openai function call', requestId);
      const name = ai_functions[0].name;
      completion = await openai.chat.completions
        .create({
          model,
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
      await logTime(start, 'openAiRequest', requestId);
      return result;
    } else {
      logLogs('Starting normal openai call', requestId);
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
      await logTime(start, 'openAiRequest', requestId);
      return completion?.choices?.[0]?.message?.content;
    }
  } catch (error) {
    functions.logger.error(`Error sending to OpenAI: ${error}`);
  }
  return 'lol';
};

export const openAiResponsesRequest = async (
  input: ResponseInput,
  requestId: string,
  model = 'gpt-4.1',
  max_output_tokens = 4000,
  temperature = 1,
  web_search = false,
  previous_response_id?: string | null,
  retry_attempts = 3,
  retry_delay = 1000,
) => {
  const start = Date.now();
  let attempts = 0;
  let previousResponseId = previous_response_id;

  while (attempts < retry_attempts) {
    try {
      logLogs(
        `Starting openai responses API call (attempt ${
          attempts + 1
        }/${retry_attempts})`,
        requestId,
      );
      if (attempts > 0) {
        previousResponseId = null;
      }
      functions.logger.debug(
        `responses call: ${JSON.stringify({
          model,
          input,
          max_output_tokens,
          temperature,
          web_search,
          previous_response_id: previousResponseId,
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

      const response = await openai.responses.create({
        model,
        input,
        previous_response_id,
        text: {
          format: {
            type: 'text',
          },
        },
        tools,
        temperature,
        max_output_tokens,
        top_p: 0.9,
      });

      functions.logger.info(
        `Responses API successful with input: ${JSON.stringify(input)}`,
      );
      await logTime(start, 'openAiResponsesRequest', requestId);

      if (response) {
        return response;
      } else {
        throw new Error('Empty response received from OpenAI');
      }
    } catch (error) {
      attempts++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Check if error is retryable (rate limiting, server errors)
      const isRetryableError =
        errorMessage.includes('rate limit') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('500') ||
        errorMessage.includes('503');

      if (attempts >= retry_attempts || !isRetryableError) {
        functions.logger.error(
          `Error sending to OpenAI Responses API (${attempts}/${retry_attempts}): ${errorMessage}`,
        );
        return null;
      }

      // Log retry attempt
      functions.logger.warn(
        `Retrying OpenAI request after error: ${errorMessage} (attempt ${attempts}/${retry_attempts})`,
      );

      // Wait before retrying
      await new Promise((resolve) =>
        setTimeout(resolve, retry_delay * attempts),
      );
    }
  }

  functions.logger.error(
    `Failed to get response after ${retry_attempts} attempts`,
  );
  return null;
};

export const updateAssistant = async (
  instructions: string,
  assistantId: string,
  requestId: string,
) => {
  const start = Date.now();
  logLogs('Updating assistant', requestId);
  try {
    const res = await openai.beta.assistants.update(assistantId, {
      instructions,
    });
    logTime(start, 'updateAssistant', requestId);
    logLogs(`Assistant updated: ${JSON.stringify(res)}`, requestId);
    return res;
  } catch (error) {
    functions.logger.error(`Error updating assistant: ${error}`);
    return null;
  }
};
