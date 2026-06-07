import { summarizeWorkspaceTool } from "./summarize-workspace.mjs";
import { controlLightsTool } from "./device-control.mjs";

// Add new tools here and mention them in the agent instructions if they change behavior.
export const tools = {
  summarizeWorkspace: summarizeWorkspaceTool,
  controlLights: controlLightsTool,
};

