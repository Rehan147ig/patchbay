import { LLMChain } from "langchain/chains";
import { ChatOpenAI } from "langchain/llms/openai";

export async function runChain() {
  const chain = new LLMChain({ llm: new ChatOpenAI({}), prompt: null as any });
  return chain.call({ input: "hello" });
}
