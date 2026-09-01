// vercel-ai-sdk legacy fixture (ai@3 -> ai@4)
import { useChat } from "ai";

export function Chat() {
  const { messages, input, handleSubmit } = useChat({ api: "/api/chat" });
  return { messages, input, handleSubmit };
}
