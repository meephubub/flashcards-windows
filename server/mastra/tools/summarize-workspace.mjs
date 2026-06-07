import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const summarizeWorkspaceTool = createTool({
  id: "summarize-workspace",
  description:
    "Summarize counts and notable study areas from the workspace context provided with the current request.",
  inputSchema: z.object({
    focus: z
      .enum(["decks", "cards", "notes", "tasks", "all"])
      .default("all")
      .describe("The workspace area to summarize."),
  }),
  outputSchema: z.object({
    summary: z.string(),
  }),
  execute: async ({ context, runtimeContext }) => {
    const workspace = runtimeContext?.get?.("workspaceContext") || {};
    const decks = Array.isArray(workspace.decks) ? workspace.decks : [];
    const cards = Array.isArray(workspace.cards) ? workspace.cards : [];
    const notes = Array.isArray(workspace.notes) ? workspace.notes : [];
    const tasks = Array.isArray(workspace.tasks) ? workspace.tasks : [];

    const lines = [];
    const include = (area) => context.focus === "all" || context.focus === area;

    if (include("decks")) lines.push(`${decks.length} decks`);
    if (include("cards")) lines.push(`${cards.length} cards in the sampled context`);
    if (include("notes")) lines.push(`${notes.length} recent notes`);
    if (include("tasks")) {
      const openTasks = tasks.filter((task) => !task.done).length;
      lines.push(`${openTasks}/${tasks.length} tasks open`);
    }

    return {
      summary: lines.length ? lines.join(", ") : "No workspace context was provided.",
    };
  },
});
