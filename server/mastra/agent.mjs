import { Agent } from "@mastra/core/agent";
import { createGroq } from "@ai-sdk/groq";
import { createMemory } from "./memory.mjs";
import { tools } from "./tools/index.mjs";

export function createStudyAgent({ dataDir, modelId }) {
  const rawKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY || process.env.VITE_GROQ_KEY || "";
  const apiKey = rawKey.trim();
  if (!apiKey) {
    throw new Error('[agent] Groq API key is missing. Ensure GROQ_API_KEY or GROQ_KEY is set in .env');
  }
  const groq = createGroq({ apiKey });
  const memory = createMemory({ dataDir });

  const studyAgent = new Agent({
    name: "flashcards-study-agent",
    description: "A concise study copilot for a local flashcards workspace.",
    instructions: [
      "You are the AI mode inside a minimal flashcards command palette.",
      "Help the user study, summarize, quiz themselves, plan homework, and turn rough notes into flashcards.",
      "Use the provided workspace context when it is relevant. If context is missing, answer normally and say what extra context would help.",
      "Use memory for stable preferences, recurring study goals, and details the user asks you to remember.",
      "Prefer short, structured Markdown. Be concrete, accurate, and useful rather than chatty.",
      "For quiz requests, ask one question at a time unless the user asks for a full quiz.",
      "For flashcard creation, use compact Front/Back pairs.",
      "You can control the smart home devices/lights using the controlLights tool if the user asks you to turn their lights on or off.",
    ].join("\n"),
    model: groq(modelId),
    memory,
    tools,
    defaultStreamOptions: {
      modelSettings: {
        temperature: 0.35,
      },
    },
  });

  return { studyAgent, memory };
}
