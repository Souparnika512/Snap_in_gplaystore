import { StringOutputParser, JsonOutputParser } from "@langchain/core/output_parsers";
import {
  ChatPromptTemplate,
  SystemMessagePromptTemplate,
  HumanMessagePromptTemplate,
} from "@langchain/core/prompts";
import { Runnable } from "@langchain/core/runnables";
import { ChatOpenAI } from "@langchain/openai";


export class LLMUtils {
  public provider!: Runnable;

  // Constructor to initialize SDK instances
  constructor(openAIApiKey: string, modelName: string, maxTokens: number) {
    this.provider = new ChatOpenAI({
      openAIApiKey: openAIApiKey,
      modelName: modelName,
      maxTokens: maxTokens,
    }).bind({
      response_format: {
        type: "json_object",
      },
    });
  }

  // Chat completion.
  async chatCompletion(sysPrompt: string, humanPrompt: string, argsValues: object): Promise<object> {
    const chatPrompt = ChatPromptTemplate.fromMessages([
      SystemMessagePromptTemplate.fromTemplate(sysPrompt),
      HumanMessagePromptTemplate.fromTemplate(humanPrompt),
    ]);
    const outputParser = new JsonOutputParser();
    const chain = chatPrompt.pipe(this.provider).pipe(outputParser);
    const response = await chain.invoke(argsValues);
    return response;
  }
}
