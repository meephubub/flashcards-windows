import { createServer } from "node:http";
import { writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
// Note: createStudyAgent will be dynamically imported after env setup
import { formatWorkspaceContext } from "./mastra/context.mjs";
import { ensureDataDir, loadLocalEnv } from "./mastra/env.mjs";
import { Logtail } from "@logtail/node";

loadLocalEnv();

// Debug log for key presence
console.log("[ai-sidecar] Groq API key set:", !!process.env.GROQ_API_KEY);

const PORT = Number(process.env.AI_SIDECAR_PORT || 8788);
const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
if (
  !process.env.GROQ_API_KEY &&
  !process.env.GROQ_KEY &&
  !process.env.VITE_GROQ_KEY
) {
  console.error(
    "[ai-sidecar] Error: No Groq API key found in environment variables.",
  );
  process.exit(1);
}
const logger = new Logtail(
  process.env.VITE_BETTERSTACK_SOURCE_TOKEN || "fallback-token",
);
console.log("[ai-sidecar] Groq API key set:", !!process.env.GROQ_API_KEY);
const DEFAULT_THREAD_ID = "flashcards-default-thread";
const DEFAULT_RESOURCE_ID = "flashcards-local-user";

const dataDir = ensureDataDir();
const { createStudyAgent } = await import("./mastra/agent.mjs");
const { studyAgent } = createStudyAgent({ dataDir, modelId: MODEL });

// Spotify Integration Helpers
const spotifyConfigPath = () => join(dataDir, "spotify-config.json");

function getSpotifyConfig() {
  const path = spotifyConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error("[spotify] Failed to read config:", err);
    return null;
  }
}

function saveSpotifyConfig(config) {
  const path = spotifyConfigPath();
  try {
    writeFileSync(path, JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("[spotify] Failed to save config:", err);
    return false;
  }
}

async function getOrRefreshSpotifyToken() {
  const config = getSpotifyConfig();
  if (!config) return null;
  if (!config.access_token) return null;

  // If token is expired or expires in 1 minute, refresh it
  if (Date.now() > (config.expires_at || 0) - 60000) {
    if (!config.refresh_token || !config.client_id || !config.client_secret) {
      return null;
    }
    console.log("[spotify] Token expired. Refreshing...");
    try {
      const basicAuth = Buffer.from(
        `${config.client_id}:${config.client_secret}`,
      ).toString("base64");
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: config.refresh_token,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("[spotify] Refresh token error:", errText);
        return null;
      }

      const data = await res.json();
      config.access_token = data.access_token;
      if (data.refresh_token) {
        config.refresh_token = data.refresh_token;
      }
      config.expires_at = Date.now() + (data.expires_in || 3600) * 1000;
      saveSpotifyConfig(config);
      console.log("[spotify] Token refreshed successfully.");
    } catch (err) {
      console.error("[spotify] Failed to refresh token:", err);
      return null;
    }
  }

  return config.access_token;
}

const server = createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  // Parse URL for pathname and search params
  const parsedUrl = new URL(
    request.url,
    `http://${request.headers.host || "localhost"}`,
  );
  const pathname = parsedUrl.pathname;

  // Spotify Routes
  if (pathname === "/spotify/config" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const { client_id, client_secret } = body;
      if (!client_id || !client_secret) {
        response.writeHead(400, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: "client_id and client_secret are required.",
          }),
        );
        return;
      }

      const existing = getSpotifyConfig() || {};
      existing.client_id = client_id;
      existing.client_secret = client_secret;

      saveSpotifyConfig(existing);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    } catch (err) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === "/spotify/auth-url" && request.method === "GET") {
    const config = getSpotifyConfig();
    if (!config || !config.client_id) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ error: "Spotify Client ID is not configured." }),
      );
      return;
    }

    const scopes = [
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
      "user-read-playback-position",
    ].join(" ");

    const authUrl =
      `https://accounts.spotify.com/authorize?` +
      new URLSearchParams({
        client_id: config.client_id,
        response_type: "code",
        redirect_uri: `http://localhost:${PORT}/spotify/callback`,
        scope: scopes,
        show_dialog: "true",
      }).toString();

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ url: authUrl }));
    return;
  }

  if (pathname === "/spotify/callback" && request.method === "GET") {
    const code = parsedUrl.searchParams.get("code");
    if (!code) {
      response.writeHead(400, { "Content-Type": "text/html" });
      response.end("<h1>Error</h1><p>No authorization code received.</p>");
      return;
    }

    const config = getSpotifyConfig();
    if (!config || !config.client_id || !config.client_secret) {
      response.writeHead(400, { "Content-Type": "text/html" });
      response.end(
        "<h1>Error</h1><p>Spotify Client ID and Secret not configured.</p>",
      );
      return;
    }

    try {
      const basicAuth = Buffer.from(
        `${config.client_id}:${config.client_secret}`,
      ).toString("base64");
      const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: `http://localhost:${PORT}/spotify/callback`,
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        response.writeHead(500, { "Content-Type": "text/html" });
        response.end(`<h1>Auth Failed</h1><p>Error: ${errText}</p>`);
        return;
      }

      const tokenData = await tokenRes.json();
      config.access_token = tokenData.access_token;
      config.refresh_token = tokenData.refresh_token;
      config.expires_at = Date.now() + (tokenData.expires_in || 3600) * 1000;
      saveSpotifyConfig(config);

      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Spotify Connected</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              background: #09090b;
              color: #fafafa;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              background: rgba(255, 255, 255, 0.03);
              border: 1px solid rgba(255, 255, 255, 0.08);
              padding: 40px;
              border-radius: 16px;
              text-align: center;
              backdrop-filter: blur(20px);
              box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
              max-width: 400px;
              width: 80%;
            }
            h1 {
              color: #1db954;
              font-size: 24px;
              margin-top: 0;
              margin-bottom: 12px;
              font-weight: 700;
            }
            p {
              color: #a1a1aa;
              font-size: 14px;
              line-height: 1.5;
              margin-bottom: 24px;
            }
            .badge {
              display: inline-flex;
              align-items: center;
              background: rgba(29, 185, 84, 0.1);
              color: #1db954;
              padding: 6px 12px;
              border-radius: 9999px;
              font-size: 12px;
              font-weight: 600;
              margin-bottom: 20px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">Success</div>
            <h1>Spotify Connected!</h1>
            <p>Your account has been linked successfully. You can close this window now and return to the application.</p>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error("[spotify] Callback error:", err);
      response.writeHead(500, { "Content-Type": "text/html" });
      response.end(
        `<h1>Auth Failed</h1><p>Internal Server Error: ${err.message}</p>`,
      );
    }
    return;
  }

  if (pathname === "/spotify/token" && request.method === "GET") {
    const config = getSpotifyConfig();
    if (!config || !config.client_id || !config.client_secret) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unconfigured" }));
      return;
    }

    if (!config.access_token) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unauthenticated" }));
      return;
    }

    const token = await getOrRefreshSpotifyToken();
    if (!token) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "auth_failed" }));
      return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ access_token: token }));
    return;
  }

  if (pathname === "/spotify/disconnect" && request.method === "POST") {
    const path = spotifyConfigPath();
    if (existsSync(path)) {
      try {
        unlinkSync(path);
      } catch (err) {
        console.error("[spotify] Failed to delete config file:", err);
      }
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, model: MODEL, memory: true }));
    return;
  }

  if (request.method !== "POST" || pathname !== "/ai") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  try {
    const body = await readJsonBody(request);
    const prompt = String(body.prompt || "").trim();

    if (!prompt) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Prompt is required." }));
      return;
    }

    response.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    });

    const contextBlock = formatWorkspaceContext(body.context);
    let streamError;
    let wroteAnyChunk = false;
    const stream = await studyAgent.stream(
      `${contextBlock}\n\nUser request:\n${prompt}`,
      {
        threadId: String(body.threadId || DEFAULT_THREAD_ID),
        resourceId: String(body.resourceId || DEFAULT_RESOURCE_ID),
        onError: ({ error }) => {
          streamError = error;
        },
      },
    );

    for await (const chunk of stream.textStream) {
      wroteAnyChunk = true;
      response.write(chunk);
    }

    if (streamError && !wroteAnyChunk) {
      response.write(`Error: ${formatError(streamError)}`);
    }

    response.end();
  } catch (error) {
    console.error("[ai-sidecar]", error);
    logger.error(
      `AI sidecar error: ${error instanceof Error ? error.message : String(error)}`,
    );
    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json" });
    }
    response.end(JSON.stringify({ error: formatError(error) }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[ai-sidecar] Mastra agent listening on http://127.0.0.1:${PORT}`,
  );
});

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJsonBody(request) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 250_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function formatError(error) {
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return String(error);
}
