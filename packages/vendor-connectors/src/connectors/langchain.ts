import { defineConnector } from "../sdk";

/**
 * LangChain connector.
 *
 * LangChain is the highest-churn SDK in the ecosystem — it renames core
 * abstractions across minors:
 * - `LLMChain`/`ConversationChain` deprecated in favor of the LangChain
 *   Expression Language (LCEL) `|` composition.
 * - `OpenAI` -> `ChatOpenAI` split (LLM vs chat model).
 * - Model constructors moved from `langchain/llms/openai` to
 *   `@langchain/openai`.
 * - `PromptTemplate.fromTemplate` remains, but `initializeAgentExecutor`
 *   -> `createAgentExecutor` style renames happen constantly.
 */
export const langchainConnector = defineConnector({
  slug: "langchain",
  identifiers: ["langchain", "@langchain/*", "langchain-core"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "LLMChain",
      newValue: "LCEL (.pipe())",
      description:
        "LLMChain and ConversationChain are deprecated; compose with LCEL: prompt.pipe(model).pipe(parser).",
      affectedSymbols: ["LLMChain", "ConversationChain", "SimpleSequentialChain"],
      breaking: true,
      evidence: { sdk: "langchain" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "langchain/llms/openai",
      newValue: "@langchain/openai",
      description:
        "Model imports moved to per-provider packages: langchain/llms/openai -> @langchain/openai ChatOpenAI.",
      affectedSymbols: ["ChatOpenAI", "OpenAI"],
      breaking: true,
      evidence: { sdk: "langchain" },
    },
    {
      changeType: "OTHER",
      oldValue: "agent executor renames",
      description:
        "Agent creation APIs are renamed across versions (initializeAgentExecutor -> createAgentExecutor -> createReactAgent).",
      affectedSymbols: ["initializeAgentExecutor", "createAgentExecutor", "createReactAgent"],
      breaking: true,
      evidence: { sdk: "langchain" },
    },
  ],
  patchSuggestions: {
    LLMChain: {
      replacement: "prompt.pipe(model)",
      description:
        "Replace LLMChain with LCEL composition: prompt.pipe(model).pipe(new StringOutputParser()).",
      confidence: 82,
    },
    ConversationChain: {
      replacement: "LCEL with messages",
      description:
        "Replace ConversationChain with LCEL using a messages history + prompt + model pipeline.",
      confidence: 80,
    },
    ChatOpenAI: {
      replacement: "@langchain/openai ChatOpenAI",
      description: "Update ChatOpenAI imports to @langchain/openai and the new constructor shape.",
      confidence: 85,
    },
  },
});
