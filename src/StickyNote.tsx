import React, { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";

export function StickyNote() {
  const [content, setContent] = useState("");
  const [color, setColor] = useState("#fef3c7"); // Default yellow sticky note color

  const colors = [
    "#fef3c7", // yellow
    "#dbeafe", // blue
    "#dcfce7", // green
    "#fce7f3", // pink
    "#f3e8ff", // purple
  ];

  const handleClose = async () => {
    try {
      const window = getCurrentWindow();
      await window.close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  };

  return (
    <div className="sticky-note-container" style={{ backgroundColor: color }}>
      <div className="sticky-note-header" data-tauri-drag-region>
        <button 
          className="close-btn" 
          onClick={handleClose} 
          title="Close"
          data-tauri-drag-region="false"
        >
          <X size={14} />
        </button>
      </div>
      <textarea
        className="sticky-note-textarea"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write your note here..."
        autoFocus
      />
    </div>
  );
}
