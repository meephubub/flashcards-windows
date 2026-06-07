import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Memory } from "@mastra/memory";
import { LibSQLStore } from "@mastra/libsql";

export function createMemory({ dataDir }) {
  const memoryDir = join(dataDir, "memory");
  mkdirSync(memoryDir, { recursive: true });

  return new Memory({
    options: {
      generateTitle: false,
      lastMessages: 12,
      workingMemory: {
        enabled: true,
        template: `
# User Study Profile

## Preferences
- Preferred response style:
- Subjects or courses:
- Quiz preferences:

## Active Goals
- Current study goals:
- Upcoming deadlines:

## Stable Facts To Remember
- 
`,
      },
    },
    storage: new LibSQLStore({
      id: "flashcards-ai-memory",
      url: `file:${join(memoryDir, "mastra-memory.db")}`,
    }),
  });
}
