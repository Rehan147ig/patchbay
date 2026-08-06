export interface ConversationLine {
  author: string;
  text: string;
}

const conversations = new Map<string, ConversationLine[]>();

export async function getConversation(channelId: string): Promise<ConversationLine[]> {
  return conversations.get(channelId) ?? [];
}

export async function appendLine(channelId: string, line: ConversationLine): Promise<void> {
  const current = conversations.get(channelId) ?? [];
  current.push(line);
  conversations.set(channelId, current);
}
