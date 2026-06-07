import { ArrowLeft, Star } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { NoteMdEditor } from "./NoteMdEditor";

export type NoteEditorPayload = {
  id?: string;
  title: string;
  content: string;
  category: string;
  project: string;
  is_starred: boolean;
  status?: string | null;
};

export type NoteEditorInitial = {
  id: string;
  title: string;
  content: string;
  category: string;
  project: string;
  is_starred: boolean;
  status?: string | null;
};

type AddNoteViewProps = {
  initialNote?: NoteEditorInitial | null;
  categorySuggestions?: string[];
  onClose: () => void;
  onSave: (payload: NoteEditorPayload) => Promise<void>;
};

export function AddNoteView({
  initialNote,
  categorySuggestions = [],
  onClose,
  onSave,
}: AddNoteViewProps) {
  const isEditing = Boolean(initialNote?.id);
  const [title, setTitle] = useState(initialNote?.title ?? "");
  const [content, setContent] = useState(initialNote?.content ?? "");
  const [category, setCategory] = useState(initialNote?.category ?? "General");
  const [project, setProject] = useState(initialNote?.project ?? "default");
  const [isStarred, setIsStarred] = useState(initialNote?.is_starred ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorKey = initialNote?.id ?? "new-note";

  const categoryListId = useMemo(
    () => `note-categories-${initialNote?.id ?? "new"}`,
    [initialNote?.id],
  );

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        const form = document.getElementById("add-note-form") as HTMLFormElement | null;
        form?.requestSubmit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedCategory = category.trim();
    const trimmedProject = project.trim();

    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    if (!trimmedCategory) {
      setError("Category is required.");
      return;
    }
    if (!trimmedProject) {
      setError("Project is required.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        id: initialNote?.id,
        title: trimmedTitle,
        content,
        category: trimmedCategory,
        project: trimmedProject,
        is_starred: isStarred,
        status: initialNote?.status ?? null,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save note.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      id="add-note-form"
      className="note-editor"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <header className="note-editor-header">
        <button
          type="button"
          className="note-editor-back"
          onClick={onClose}
          title="Back"
        >
          <ArrowLeft size={16} />
        </button>
        <input
          className="note-editor-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Note title"
          autoFocus={!isEditing}
          spellCheck
        />
        <div className="note-editor-header-actions">
          <button
            type="button"
            className={`note-editor-star ${isStarred ? "active" : ""}`}
            onClick={() => setIsStarred((starred) => !starred)}
            title={isStarred ? "Unstar" : "Star"}
          >
            <Star size={16} fill={isStarred ? "currentColor" : "none"} />
          </button>
          <button
            type="submit"
            className="note-editor-save"
            disabled={saving}
          >
            {saving ? "Saving…" : isEditing ? "Update" : "Save"}
          </button>
        </div>
      </header>

      <div className="note-editor-meta">
        <label className="note-editor-field">
          <span>Category</span>
          <input
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            list={categoryListId}
            placeholder="General"
          />
        </label>
        <datalist id={categoryListId}>
          {categorySuggestions.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <label className="note-editor-field">
          <span>Project</span>
          <input
            value={project}
            onChange={(event) => setProject(event.target.value)}
            placeholder="default"
          />
        </label>
      </div>

      {error && <p className="note-editor-error">{error}</p>}

      <div className="note-editor-body">
        <NoteMdEditor
          editorKey={editorKey}
          markdown={content}
          onChange={setContent}
        />
      </div>

      <footer className="note-editor-footer">
        <span>Format as you type — saved as Markdown</span>
        <span>
          <kbd className="study-kbd">⌘</kbd>
          <kbd className="study-kbd">S</kbd> save
        </span>
      </footer>
    </form>
  );
}
