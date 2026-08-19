import { openai } from "./lib";
import { getStripe } from "./lib";

openai.createChatCompletion({ model: "gpt-4", messages: [] });

const s = getStripe(process.env.STRIPE_SECRET_KEY ?? "sk-test");
s.customers.create({ email: "a@example.com" });
