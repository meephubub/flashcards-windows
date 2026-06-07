import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ExternalLink, Globe } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import {
  faviconUrl,
  linkHostname,
  parseLinkContent,
  type MoodboardLinkData,
} from "./lib/moodboard-link";
import {
  getMoodboardTile,
  saveMoodboardTile,
  type MoodboardTileKind,
} from "./lib/moodboard-storage";

const MOODBOARD_TEXT_DRAG_STRIP_HEIGHT = 14;

function readTileParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    id: params.get("id") ?? "",
    kind: (params.get("kind") ?? "text") as MoodboardTileKind,
  };
}

function MoodboardLinkTile({ data }: { data: MoodboardLinkData }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const host = linkHostname(data.url);
  const title = data.title?.trim() || data.siteName?.trim() || host;
  const showPreview = Boolean(data.imageUrl) && !previewFailed;

  const openLink = useCallback(() => {
    void invoke("open_external_url", { url: data.url }).catch((error) => {
      console.error("Failed to open link:", error);
    });
  }, [data.url]);

  return (
    <div className="moodboard-tile-shell moodboard-tile-shell--link">
      <div className="moodboard-tile-drag-strip moodboard-tile-drag-strip--link" data-tauri-drag-region />
      <button
        type="button"
        className="moodboard-link-preview"
        data-tauri-drag-region
        onClick={openLink}
        title={title}
      >
        {showPreview ? (
          <img
            src={data.imageUrl!}
            alt=""
            className="moodboard-link-preview-img"
            draggable={false}
            onError={() => setPreviewFailed(true)}
          />
        ) : (
          <div className="moodboard-link-preview-fallback" aria-hidden>
            <Globe size={28} strokeWidth={1.25} />
          </div>
        )}
        <span className="moodboard-link-preview-shade" aria-hidden />
      </button>
      <button type="button" className="moodboard-link-footer" onClick={openLink}>
        <img
          src={faviconUrl(data.url)}
          alt=""
          className="moodboard-link-favicon"
          draggable={false}
        />
        <span className="moodboard-link-footer-text">
          <span className="moodboard-link-footer-title">{title}</span>
          <span className="moodboard-link-footer-host">{host}</span>
        </span>
        <ExternalLink size={14} className="moodboard-link-open-icon" aria-hidden />
      </button>
    </div>
  );
}

export function MoodboardTileWindow() {
  const { id, kind } = useMemo(() => readTileParams(), []);
  const [content, setContent] = useState("");
  const [missing, setMissing] = useState(false);
  const isImage = kind === "image";
  const isLink = kind === "link";

  const linkData = useMemo(
    () => (isLink && content ? parseLinkContent(content) : null),
    [content, isLink],
  );

  useEffect(() => {
    if (!id) {
      setMissing(true);
      return;
    }
    const tile = getMoodboardTile(id);
    if (!tile) {
      setMissing(true);
      return;
    }
    setContent(tile.content);
  }, [id]);

  useEffect(() => {
    if (!id || kind !== "text" || missing) return;
    const timer = window.setTimeout(() => {
      const existing = getMoodboardTile(id);
      if (!existing) return;
      saveMoodboardTile({ ...existing, content });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [content, id, kind, missing]);

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      if (!id) return;
      const img = event.currentTarget;
      void invoke("init_moodboard_image_tile", {
        id,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      }).catch((error) => {
        console.error("Failed to size moodboard image tile:", error);
      });
    },
    [id],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void getCurrentWindow().close();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  if (missing) {
    return isImage ? null : <div className="moodboard-tile-shell moodboard-tile-shell--bare" />;
  }

  if (isLink && linkData?.url) {
    return <MoodboardLinkTile data={linkData} />;
  }

  if (isImage) {
    if (!content) {
      return null;
    }

    return (
      <img
        src={content}
        alt=""
        draggable={false}
        onLoad={handleImageLoad}
        className="moodboard-tile-image-pure"
        data-tauri-drag-region
      />
    );
  }

  return (
    <div className="moodboard-tile-shell moodboard-tile-shell--text">
      <div
        className="moodboard-tile-drag-strip"
        data-tauri-drag-region
        style={{ height: MOODBOARD_TEXT_DRAG_STRIP_HEIGHT }}
      />
      <textarea
        className="moodboard-tile-textarea"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder=""
        spellCheck
        data-tauri-drag-region={false}
      />
    </div>
  );
}
