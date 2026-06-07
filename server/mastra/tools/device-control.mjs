import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const VOICEMONKEY_LIGHT_OFF_URL =
  "https://api-v2.voicemonkey.io/trigger?token=814e797e65ae46a6828e1001150bd8ac_0a30f8185cdd6014f8a9b1d0ef1b326a&device=fan-off";
const VOICEMONKEY_LIGHT_ON_URL =
  "https://api-v2.voicemonkey.io/trigger?token=814e797e65ae46a6828e1001150bd8ac_0a30f8185cdd6014f8a9b1d0ef1b326a&device=fan-on";

export const controlLightsTool = createTool({
  id: "control-lights",
  description: "Turn the lights on or off via VoiceMonkey API trigger.",
  inputSchema: z.object({
    action: z.enum(["on", "off"]).describe("Whether to turn the lights on or off."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const url = context.action === "on" ? VOICEMONKEY_LIGHT_ON_URL : VOICEMONKEY_LIGHT_OFF_URL;
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return {
          success: true,
          message: `Successfully turned the lights ${context.action}.`,
        };
      } else {
        return {
          success: false,
          message: `Failed to trigger lights: ${response.statusText}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Error controlling lights: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
});
