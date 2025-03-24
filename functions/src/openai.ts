import * as functions from 'firebase-functions';
import OpenAI from 'openai';
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
  input: any[],
  model: string = 'gpt-4o',
  max_output_tokens: number = 2048,
  temperature: number = 1,
  tools: any[] = [],
  reasoning: boolean = false,
  reasoningEffort: 'low' | 'medium' | 'high' = 'low',
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
        tools,
      })}`,
    );
    
    const response = await openai.responses.create({
      model,
      input,
      text: {
        format: {
          type: 'text'
        }
      },
      reasoning: {
        effort: reasoningEffort,
      },
      tools,
      temperature,
      max_output_tokens,
      top_p: 1,
      store: true
    }).catch((error) => {
      functions.logger.error(`Error sending to OpenAI Responses API: ${error}`);
    });
    
    await logTime(start, 'openAiResponsesRequest');
    return response;
  } catch (error) {
    functions.logger.error(`Error sending to OpenAI Responses API: ${error}`);
  }
  return 'Error in responses API';
}; 