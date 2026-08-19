import { openai } from "./lib";

const a = openai;
const b = a;
b.createChatCompletion({ model: "gpt-4", messages: [] });
