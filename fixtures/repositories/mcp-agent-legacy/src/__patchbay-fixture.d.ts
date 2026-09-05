declare const process: any;

declare module "express" {
  const express: any;
  export default express;
}

declare module "@modelcontextprotocol/sdk" {
  export class Client {
    constructor(opts?: unknown);
    connect(transport?: unknown): Promise<void>;
    listTools(): Promise<{ tools: Array<{ name: string }> }>;
    close(): Promise<void>;
  }
}

declare module "pino" {
  const pino: any;
  export default pino;
}
