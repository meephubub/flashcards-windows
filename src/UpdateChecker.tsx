import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export default function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function runCheck() {
      try {
        const update = await check();

        if (!update || cancelled) return;

        setUpdateAvailable(true);
      } catch (e: any) {
        setError(e?.message ?? "Update check failed");
      }
    }

    runCheck();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpdate() {
    try {
      setDownloading(true);

      const update = await check();
      if (!update) return;

      await update.downloadAndInstall();

      await relaunch();
    } catch (e: any) {
      setError(e?.message ?? "Update failed");
      setDownloading(false);
    }
  }

  if (!updateAvailable) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h2>Update available</h2>
        <p>A new version is ready to install.</p>

        {error && <p style={styles.error}>{error}</p>}

        <button onClick={handleUpdate} disabled={downloading}>
          {downloading ? "Installing..." : "Install update"}
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modal: {
    background: "#111",
    color: "#fff",
    padding: 20,
    borderRadius: 12,
    width: 320,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  error: {
    color: "tomato",
    fontSize: 12,
  },
};
