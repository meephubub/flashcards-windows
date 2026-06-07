import { invoke } from "@tauri-apps/api/core";
import { ImagePlus, LayoutGrid, Link2, Loader2, Trash2, Type } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  linkTileLabel,
  normalizeLinkInput,
  parseLinkContent,
  previewFromResponse,
  serializeLinkContent,
  type LinkPreviewResponse,
} from "./lib/moodboard-link";
import {
  createMoodboardId,
  listMoodboardTiles,
  removeMoodboardTile,
  saveMoodboardTile,
  type MoodboardTileKind,
  type MoodboardTileRecord,
} from "./lib/moodboard-storage";

type MoodboardPanelProps = {
  onClose: () => void;
};

async function openTileWindow(id: string, kind: MoodboardTileKind) {
  await invoke("open_moodboard_tile", { id, kind });
}

async function closeTileWindow(id: string) {
  try {
    await invoke("close_moodboard_tile", { id });
  } catch {
    /* window may already be closed */
  }
}

export function MoodboardPanel({ onClose }: MoodboardPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tiles, setTiles] = useState<MoodboardTileRecord[]>(() =>
    listMoodboardTiles(),
  );
  const [linkUrl, setLinkUrl] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const refreshTiles = useCallback(() => {
    setTiles(listMoodboardTiles());
  }, []);

  const spawnTextTile = useCallback(async () => {
    const id = createMoodboardId();
    saveMoodboardTile({
      id,
      kind: "text",
      content: "",
      createdAt: Date.now(),
    });
    refreshTiles();
    await openTileWindow(id, "text");
  }, [refreshTiles]);

  const spawnImageTile = useCallback(
    async (dataUrl: string) => {
      const id = createMoodboardId();
      saveMoodboardTile({
        id,
        kind: "image",
        content: dataUrl,
        createdAt: Date.now(),
      });
      refreshTiles();
      await openTileWindow(id, "image");
    },
    [refreshTiles],
  );

  const spawnLinkTile = useCallback(async () => {
    const normalized = normalizeLinkInput(linkUrl);
    if (!normalized) {
      setLinkError("Enter a valid URL");
      return;
    }

    setLinkBusy(true);
    setLinkError(null);

    try {
      const preview = await invoke<LinkPreviewResponse>("fetch_link_preview", {
        url: normalized,
      });
      const id = createMoodboardId();
      const data = previewFromResponse(preview);
      saveMoodboardTile({
        id,
        kind: "link",
        content: serializeLinkContent(data),
        createdAt: Date.now(),
      });
      setLinkUrl("");
      refreshTiles();
      await openTileWindow(id, "link");
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : "Could not add link");
    } finally {
      setLinkBusy(false);
    }
  }, [linkUrl, refreshTiles]);

  const handleImagePick = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!file.type.startsWith("image/")) return;

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          void spawnImageTile(reader.result);
        }
      };
      reader.readAsDataURL(file);
    },
    [spawnImageTile],
  );

  const reopenTile = useCallback(async (tile: MoodboardTileRecord) => {
    await openTileWindow(tile.id, tile.kind);
  }, []);

  const deleteTile = useCallback(
    async (id: string) => {
      await closeTileWindow(id);
      removeMoodboardTile(id);
      refreshTiles();
    },
    [refreshTiles],
  );

  const closeAllTiles = useCallback(async () => {
    await invoke("close_all_moodboard_tiles");
  }, []);

  return (
    <div className="moodboard-panel">
      <header className="moodboard-panel-header">
        <div className="moodboard-panel-title">
          <LayoutGrid size={18} strokeWidth={1.75} />
          <h2>Moodboard</h2>
        </div>
        <p className="moodboard-panel-sub">
          Notes, images, and links open as floating tiles. Press Esc on a tile to close it.
        </p>
      </header>

      <div className="moodboard-panel-actions">
        <button type="button" className="moodboard-action-btn" onClick={spawnTextTile}>
          <Type size={16} />
          Add text
        </button>
        <button
          type="button"
          className="moodboard-action-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          <ImagePlus size={16} />
          Add image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void handleImagePick(event)}
        />
      </div>

      <div className="moodboard-link-add">
        <div className="moodboard-link-add-field">
          <Link2 size={15} className="moodboard-link-add-icon" aria-hidden />
          <input
            type="url"
            className="moodboard-link-add-input"
            placeholder="Paste a link…"
            value={linkUrl}
            disabled={linkBusy}
            onChange={(event) => {
              setLinkUrl(event.target.value);
              if (linkError) setLinkError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void spawnLinkTile();
              }
            }}
          />
        </div>
        <button
          type="button"
          className="moodboard-link-add-btn"
          disabled={linkBusy || !linkUrl.trim()}
          onClick={() => void spawnLinkTile()}
        >
          {linkBusy ? <Loader2 size={15} className="moodboard-link-add-spinner" /> : "Add"}
        </button>
        {linkError ? <p className="moodboard-link-add-error">{linkError}</p> : null}
      </div>

      <div className="moodboard-panel-list">
        <div className="moodboard-panel-list-head">
          <span>Your tiles</span>
          <span>{tiles.length}</span>
        </div>
        {tiles.length === 0 ? (
          <p className="moodboard-panel-empty">
            Nothing here yet. Add text, an image, or a link.
          </p>
        ) : (
          <ul className="moodboard-tile-list">
            {tiles.map((tile) => {
              const linkData =
                tile.kind === "link" ? parseLinkContent(tile.content) : null;
              return (
                <li key={tile.id} className="moodboard-tile-row">
                  <button
                    type="button"
                    className="moodboard-tile-row-main"
                    onClick={() => void reopenTile(tile)}
                  >
                    <span className="moodboard-tile-row-icon">
                      {tile.kind === "image" ? (
                        tile.content ? (
                          <img src={tile.content} alt="" />
                        ) : (
                          <ImagePlus size={14} />
                        )
                      ) : tile.kind === "link" && linkData ? (
                        linkData.imageUrl ? (
                          <img src={linkData.imageUrl} alt="" />
                        ) : (
                          <Link2 size={14} />
                        )
                      ) : tile.kind === "link" ? (
                        <Link2 size={14} />
                      ) : (
                        <Type size={14} />
                      )}
                    </span>
                    <span className="moodboard-tile-row-text">
                      {tile.kind === "image"
                        ? "Image"
                        : tile.kind === "link" && linkData
                          ? linkTileLabel(linkData)
                          : tile.content.trim() || "Empty note"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="moodboard-tile-row-delete"
                    title="Delete"
                    onClick={() => void deleteTile(tile.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className="moodboard-panel-footer">
        {tiles.length > 0 && (
          <button
            type="button"
            className="moodboard-footer-ghost"
            onClick={() => void closeAllTiles()}
          >
            Close all windows
          </button>
        )}
        <button type="button" className="moodboard-footer-primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </div>
  );
}
