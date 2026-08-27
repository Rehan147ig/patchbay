declare const process: any;

declare module "openai" {
  export default class OpenAI {
    createChatCompletion: (opts: unknown) => any;
    createEmbedding: (opts: unknown) => any;
    chat: { completions: { create: (opts: unknown) => any } };
    embeddings: { create: (opts: unknown) => any };
    constructor(opts?: unknown);
  }
  export class OpenAI {
    createChatCompletion: (opts: unknown) => any;
    createEmbedding: (opts: unknown) => any;
    chat: { completions: { create: (opts: unknown) => any } };
    embeddings: { create: (opts: unknown) => any };
    constructor(opts?: unknown);
  }
}

declare module "pino" {
  const pino: any;
  export default pino;
}
