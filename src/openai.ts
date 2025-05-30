import * as functions from 'firebase-functions/v2';
import OpenAI from 'openai';
import { ResponseInput, Tool } from 'openai/resources/responses/responses';
import { logLogs, logTime } from './utils';

// Get environment variables for OpenAI
const openaitoken = process.env.OPENAI_API_KEY ?? '';
const openAiOrgId = process.env.OPENAI_ORG_ID;
const vectorStoreId = process.env.VECTOR_STORE_ID ?? '';

// Helper function to get vector store ID if configured
const getVectorStoreIds = (): string[] => {
  return vectorStoreId ? [vectorStoreId] : [];
};

// Helper function to extract file search results from response
export const extractFileSearchResults = (response: any): string[] => {
  if (!response?.file_search_call?.results) return [];

  const results: string[] = [];
  for (const result of response.file_search_call.results) {
    if (result.content && typeof result.content === 'string') {
      results.push(result.content);
    }
  }
  return results;
};

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

interface OpenAiResponsesRequestParams {
  instructions: string;
  input: ResponseInput;
  requestId: string;
  model: string;
  max_output_tokens?: number;
  temperature?: number;
  web_search?: boolean;
  function_tools?: any[];
  tool_choice?: 'auto' | 'required';
  file_search?: boolean;
  previous_response_id?: string | null;
  retry_attempts?: number;
  retry_delay?: number;
}

/**
 * Sends a request to OpenAI's Responses API with retry logic and automatic file search integration.
 */
export const openAiResponsesRequest = async ({
  instructions,
  input,
  requestId,
  model,
  max_output_tokens = 4000,
  temperature = 1,
  web_search = false,
  function_tools,
  tool_choice = 'auto',
  file_search = true,
  previous_response_id,
  retry_attempts = 3,
  retry_delay = 1000,
}: OpenAiResponsesRequestParams) => {
  const start = Date.now();
  let attempts = 0;
  let previousResponseId = previous_response_id;

  const vectorStoreIds = file_search ? getVectorStoreIds() : [];

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
          instructions,
          model,
          input,
          max_output_tokens,
          temperature,
          web_search,
          file_search: file_search,
          vector_store_ids: vectorStoreIds,
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

      const fileSearchConfig: Array<Tool> = [
        {
          type: 'file_search',
          vector_store_ids: vectorStoreIds,
        },
      ];

      // Combine tools: web search, file search, and function calls
      const tools: Array<Tool> = [];
      if (web_search) {
        tools.push(...webSearchConfig);
      }
      if (file_search && vectorStoreIds.length > 0) {
        tools.push(...fileSearchConfig);
      }
      if (function_tools && function_tools.length > 0) {
        tools.push(...function_tools);
      }

      const response = await openai.responses.create({
        instructions,
        model,
        input,
        previous_response_id,
        text: {
          format: {
            type: 'text',
          },
        },
        tools: tools.length > 0 ? tools : undefined,
        parallel_tool_calls: true,
        tool_choice,
        truncation: 'auto',
        include: ['file_search_call.results'],
        temperature,
        max_output_tokens,
      });

      functions.logger.info(
        `Responses API successful with output: ${JSON.stringify(response)}`,
      );

      // Log file search results if included
      if (response && file_search) {
        const fileSearchResults = extractFileSearchResults(response);
        if (fileSearchResults.length > 0) {
          logLogs(
            `File search returned ${fileSearchResults.length} results`,
            requestId,
          );
        }
      }

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
