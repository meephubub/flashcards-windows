import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function findEnvFile(startDir) {
  let dir = startDir;
  while (dir) {
    const envPath = join(dir, ".env");
    if (existsSync(envPath)) {
      return envPath;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

export function loadLocalEnv() {
  try {
    let envPath = findEnvFile(process.cwd());
    if (!envPath) {
      envPath = findEnvFile(dirname(process.execPath));
    }
    if (envPath && existsSync(envPath)) {
      const content = readFileSync(envPath, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const [key, ...valueParts] = trimmed.split("=");
          const value = valueParts.join("=");
          if (key && value) {
            process.env[key.trim()] = value.trim().replace(/^["']|["']$/g, "");
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to load local env:", err);
  }
}

export function ensureDataDir() {
  let dataDir = process.env.APP_DATA_DIR;
  if (!dataDir) {
    const appData = process.env.APPDATA || process.env.LOCALAPPDATA;
    if (appData) {
      dataDir = join(appData, "com.flashcards.app");
    } else {
      dataDir = join(process.env.HOME || process.env.USERPROFILE || ".", ".flashcards-app");
    }
  }
  return dataDir;
}
