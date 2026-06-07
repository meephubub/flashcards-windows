export function formatWorkspaceContext(context) {
  if (!context) return "No workspace context provided.";

  const parts = [];

  if (context.decks && context.decks.length > 0) {
    parts.push(
      "### Decks in Workspace:\n" +
        context.decks
          .map((d) => `- ${d.name}${d.description ? ` (${d.description})` : ""}: ${d.cardCount} cards`)
          .join("\n"),
    );
  }

  if (context.cards && context.cards.length > 0) {
    parts.push(
      "### Sampled Flashcards:\n" +
        context.cards
          .map((c) => `- Front: ${c.front} | Back: ${c.back}${c.tag ? ` | Tag: ${c.tag}` : ""}`)
          .join("\n"),
    );
  }

  if (context.notes && context.notes.length > 0) {
    parts.push(
      "### Recent Notes:\n" +
        context.notes
          .map((n) => `- [${n.category || "Note"}] ${n.title}: ${n.content}${n.status ? ` (Status: ${n.status})` : ""}`)
          .join("\n"),
    );
  }

  if (context.tasks && context.tasks.length > 0) {
    parts.push(
      "### Homework/Tasks:\n" +
        context.tasks
          .map(
            (t) =>
              `- [${t.done ? "x" : " "}] ${t.subject}${t.due_date ? ` (Due: ${t.due_date})` : ""}${t.priority ? ` [Priority: ${t.priority}]` : ""}`,
          )
          .join("\n"),
    );
  }

  return parts.length > 0
    ? "## CURRENT WORKSPACE CONTEXT\n\n" + parts.join("\n\n")
    : "No workspace context was provided.";
}
