import * as functions from 'firebase-functions/v2';
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
  model = 'gpt-4.1',
  max_output_tokens = 4000,
  temperature = 1,
  web_search = false,
  previous_response_id?: string | null,
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
      })
      .catch((error) => {
        functions.logger.error(
          `Error sending to OpenAI Responses API: ${error}`,
        );
      });
    functions.logger.info(`Responses api input: ${JSON.stringify(input)}`);
    await logTime(start, 'openAiResponsesRequest');
    return response;
  } catch (error) {
    functions.logger.error(`Error sending to OpenAI Responses API: ${error}`);
    return null;
  }
};

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
