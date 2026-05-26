import {
  ArrowLeft,
  BarChart2,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  FileText,
  Home,
  Library,
  Lightbulb,
  LightbulbOff,
  ListTodo,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const SUPABASE_URL = "https://jouowhbhiuuewfwpntex.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvdW93aGJoaXV1ZXdmd3BudGV4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Njk3NDA4MiwiZXhwIjoyMDYyNTUwMDgyfQ.Lg4h6dLSex0jtGVOZ3IKGE4yGffGZwDvFI20mFQCDwg";
const VOICEMONKEY_LIGHT_OFF_URL =
  "https://api-v2.voicemonkey.io/trigger?token=814e797e65ae46a6828e1001150bd8ac_0a30f8185cdd6014f8a9b1d0ef1b326a&device=fan-off";
const VOICEMONKEY_LIGHT_ON_URL =
  "https://api-v2.voicemonkey.io/trigger?token=814e797e65ae46a6828e1001150bd8ac_0a30f8185cdd6014f8a9b1d0ef1b326a&device=fan-on";

// Enable preview mode to bypass authentication (set to false in production)
const PREVIEW_MODE = false;

type Deck = {
  id: string;
  name: string;
  description?: string | null;
};

type Card = {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  tag?: string | null;
  front_img_url?: string | null;
  created_at?: string | null;
};

type Note = {
  id: string;
  title: string;
  content: string;
  category: string;
  project: string;
  status?: string | null;
  folder_id?: string | null;
  is_starred: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type Task = {
  id: number;
  created_at: string;
  user_id: string;
  due_date: string | null;
  subject: string | null;
  priority: number | null;
  done: boolean | null;
  metadata: Record<string, unknown> | null;
  reminder_minutes: number | null;
};

type ViewMode = "palette" | "deck" | "tasks";

type PaletteItem = {
  id: string;
  label: string;
  section: "GO TO" | "STUDY" | "CONTROL";
  icon: React.ReactNode;
  run: () => void;
};

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

function tagsFromCard(card: Card) {
  if (!card.tag) return [];
  return card.tag
    .split(/[,\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function uniqueTags(cards: Card[]) {
  return Array.from(new Set(cards.flatMap(tagsFromCard))).sort((a, b) =>
    a.localeCompare(b),
  );
}

function cardsForDeck(cards: Card[], deckId: string | number) {
  return cards.filter((card) => String(card.deck_id) === String(deckId));
}

export function DecksActionSearchBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [mode, setMode] = useState<ViewMode>("palette");
  const [query, setQuery] = useState("");
  const [cardQuery, setCardQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [activeNoteIndex, setActiveNoteIndex] = useState(0);
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [selectedDeck, setSelectedDeck] = useState<Deck | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"created" | "alphabetic">("created");
  const [taskSortMode, setTaskSortMode] = useState<"due_date" | "priority">(
    "due_date",
  );
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskSubject, setNewTaskSubject] = useState("");
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<number>(2);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const animateWindowSize = useCallback((_width: number, _height: number) => {
    // Window size animation is handled by CSS in web environment
    // Tauri would handle native window resizing here
  }, []);

  useEffect(
    () => () => {
      // Cleanup for window resize animations (Tauri only)
    },
    [],
  );

  const refreshWorkspace = useCallback(async () => {
    setSyncing(true);
    try {
      const [
        { data: deckRows, error: deckError },
        { data: cardRows, error: cardError },
        { data: noteRows, error: noteError },
        { data: taskRows, error: taskError },
      ] = await Promise.all([
        supabase.from("decks").select("*"),
        supabase.from("cards").select("*"),
        supabase
          .from("notes")
          .select("*")
          .order("updated_at", { ascending: false }),
        supabase
          .from("homework")
          .select("*")
          .order("due_date", { ascending: true }),
      ]);

      if (deckError) throw deckError;
      if (cardError) throw cardError;
      if (noteError) throw noteError;
      if (taskError) throw taskError;

      setDecks((deckRows ?? []) as Deck[]);
      setCards((cardRows ?? []) as Card[]);
      setNotes((noteRows ?? []) as Note[]);
      setTasks((taskRows ?? []) as Task[]);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
      if (data.session) void refreshWorkspace();
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession) void refreshWorkspace();
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [refreshWorkspace]);

  useEffect(() => {
    // Tauri trigger-open event listener would go here
    // In web environment, the component is always visible
  }, [animateWindowSize]);

  useEffect(() => {
    // Escape key handling - in web, we could close modals or reset state
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mode === "tasks" && showAddTask) {
        setShowAddTask(false);
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mode, showAddTask]);

  useEffect(() => {
    if (mode === "palette") {
      setTimeout(() => inputRef.current?.focus(), 20);
    } else if (mode === "tasks") {
      animateWindowSize(780, 720);
    } else {
      setTimeout(() => cardInputRef.current?.focus(), 20);
      animateWindowSize(960, 720);
    }
  }, [animateWindowSize, mode]);

  const deckSearchMatch = query.match(/^(decks?|deck):\s*/i);
  const isDeckSearch = Boolean(deckSearchMatch);
  const noteSearchMatch = query.match(/^(notes?|note):\s*/i);
  const isNoteSearch = Boolean(noteSearchMatch);
  const isAiMode = /^ai:\s*/i.test(query);

  useEffect(() => {
    if (mode !== "palette") return;
    const contentWidth = isNoteSearch ? 780 : 680;
    const contentHeight = isNoteSearch ? 884 : 600;
    const glowGutter = isAiMode ? 64 : 0;

    animateWindowSize(contentWidth + glowGutter, contentHeight + glowGutter);
  }, [animateWindowSize, isAiMode, isNoteSearch, mode]);

  const filteredDecks = useMemo(() => {
    if (!isDeckSearch) return [];
    const normalizedQuery = query
      .replace(/^(decks?|deck):\s*/i, "")
      .trim()
      .toLowerCase();
    return decks.filter((deck) =>
      normalizedQuery
        ? deck.name.toLowerCase().includes(normalizedQuery)
        : true,
    );
  }, [decks, isDeckSearch, query]);

  const selectedDeckCards = useMemo(() => {
    if (!selectedDeck) return [];
    const deckCards = cardsForDeck(cards, selectedDeck.id);
    const filtered = deckCards.filter((card) => {
      const queryMatch =
        !cardQuery.trim() ||
        card.front.toLowerCase().includes(cardQuery.toLowerCase()) ||
        card.back.toLowerCase().includes(cardQuery.toLowerCase());
      const tagMatch = !selectedTag || tagsFromCard(card).includes(selectedTag);
      return queryMatch && tagMatch;
    });

    if (sortMode === "alphabetic") {
      return [...filtered].sort((a, b) => a.front.localeCompare(b.front));
    }

    return [...filtered].sort((a, b) =>
      String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
    );
  }, [cards, selectedDeck, cardQuery, selectedTag, sortMode]);

  const filteredNotes = useMemo(() => {
    if (!isNoteSearch) return [];
    const normalizedQuery = query
      .replace(/^(notes?|note):\s*/i, "")
      .trim()
      .toLowerCase();

    return notes.filter((note) => {
      if (!normalizedQuery) return true;
      return (
        note.title.toLowerCase().includes(normalizedQuery) ||
        note.content.toLowerCase().includes(normalizedQuery) ||
        note.category.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [isNoteSearch, notes, query]);

  const activeNote = filteredNotes[activeNoteIndex] ?? null;

  const sortedTasks = useMemo(() => {
    const sorted = [...tasks];
    if (taskSortMode === "due_date") {
      return sorted.sort((a, b) => {
        if (!a.due_date && !b.due_date)
          return (b.priority ?? 0) - (a.priority ?? 0);
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        const dateCompare =
          new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return (b.priority ?? 0) - (a.priority ?? 0);
      });
    } else {
      return sorted.sort((a, b) => {
        const priorityCompare = (b.priority ?? 0) - (a.priority ?? 0);
        if (priorityCompare !== 0) return priorityCompare;
        if (!a.due_date && !b.due_date) return 0;
        if (!a.due_date) return 1;
        if (!b.due_date) return -1;
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      });
    }
  }, [tasks, taskSortMode]);

  const activeTask = sortedTasks[activeTaskIndex] ?? null;

  const activeCard = selectedDeckCards[activeCardIndex] ?? null;
  const currentTags = useMemo(
    () => uniqueTags(selectedDeck ? cardsForDeck(cards, selectedDeck.id) : []),
    [cards, selectedDeck],
  );

  useEffect(() => {
    setActiveIndex(0);
    setActiveNoteIndex(0);
  }, [query]);

  useEffect(() => {
    setActiveCardIndex(0);
  }, [cardQuery, selectedTag, sortMode]);

  useEffect(() => {
    setActiveTaskIndex(0);
  }, [taskSortMode]);

  useEffect(() => {
    if (mode !== "deck") return;
    const activeRow = document.querySelector(".card-list button.active");
    activeRow?.scrollIntoView({ block: "nearest" });
  }, [activeCardIndex, mode]);

  useEffect(() => {
    if (mode !== "tasks") return;
    const activeRow = document.querySelector(".task-list button.active");
    activeRow?.scrollIntoView({ block: "nearest" });
  }, [activeTaskIndex, mode]);

  const openDeck = useCallback((deck: Deck) => {
    setSelectedDeck(deck);
    setMode("deck");
    setCardQuery("");
    setSelectedTag(null);
    setActiveCardIndex(0);
  }, []);

  const closeWindow = useCallback(() => {
    // In Tauri, this would hide the window to tray
    // In web, we can reset to home state
    setMode("palette");
    setQuery("");
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setDecks([]);
    setCards([]);
    setNotes([]);
    setTasks([]);
    setMode("palette");
  }, []);

  const triggerVoiceMonkey = useCallback(async (url: string) => {
    await fetch(url, { method: "GET" });
  }, []);

  const openTasks = useCallback(() => {
    setMode("tasks");
    setActiveTaskIndex(0);
  }, []);

  const addTask = useCallback(async () => {
    if (!newTaskSubject.trim()) return;

    const { error } = await supabase.from("homework").insert({
      subject: newTaskSubject.trim(),
      due_date: newTaskDueDate || null,
      priority: newTaskPriority,
      done: false,
    });

    if (!error) {
      setNewTaskSubject("");
      setNewTaskDueDate("");
      setNewTaskPriority(2);
      setShowAddTask(false);
      await refreshWorkspace();
    }
  }, [newTaskSubject, newTaskDueDate, newTaskPriority, refreshWorkspace]);

  const toggleTaskDone = useCallback(
    async (task: Task) => {
      await supabase
        .from("homework")
        .update({ done: !task.done })
        .eq("id", task.id);
      await refreshWorkspace();
    },
    [refreshWorkspace],
  );

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "home",
        label: "Home",
        section: "GO TO",
        icon: <Home size={16} />,
        run: () => setQuery(""),
      },
      {
        id: "decks",
        label: "Decks",
        section: "GO TO",
        icon: <Library size={16} />,
        run: () => setQuery("decks:"),
      },
      {
        id: "notes",
        label: "Notes",
        section: "GO TO",
        icon: <FileText size={16} />,
        run: () => setQuery("notes:"),
      },
      {
        id: "tasks",
        label: "Tasks",
        section: "GO TO",
        icon: <ListTodo size={16} />,
        run: openTasks,
      },
      {
        id: "review-all",
        label: "Review All",
        section: "GO TO",
        icon: <Play size={16} />,
        run: () => setQuery("review all"),
      },
      {
        id: "statistics",
        label: "Statistics",
        section: "GO TO",
        icon: <BarChart2 size={16} />,
        run: () => setQuery("statistics"),
      },
      {
        id: "study-tags",
        label: "Study by Tags",
        section: "STUDY",
        icon: <Tag size={16} />,
        run: () => setQuery("tag:"),
      },
      {
        id: "study-decks",
        label: "Study Multiple Decks",
        section: "STUDY",
        icon: <Library size={16} />,
        run: () => setQuery("decks:"),
      },
      {
        id: "study-ahead",
        label: "Study Ahead",
        section: "STUDY",
        icon: <Play size={16} />,
        run: () => setQuery("study ahead"),
      },
      {
        id: "refresh",
        label: syncing ? "Syncing..." : "Refresh Data",
        section: "CONTROL",
        icon: <RefreshCw size={16} className={syncing ? "spin" : ""} />,
        run: refreshWorkspace,
      },
      {
        id: "lights-on",
        label: "Light On",
        section: "CONTROL",
        icon: <Lightbulb size={16} />,
        run: () => void triggerVoiceMonkey(VOICEMONKEY_LIGHT_ON_URL),
      },
      {
        id: "lights-off",
        label: "Light Off",
        section: "CONTROL",
        icon: <LightbulbOff size={16} />,
        run: () => void triggerVoiceMonkey(VOICEMONKEY_LIGHT_OFF_URL),
      },
      {
        id: "sign-out",
        label: "Sign Out",
        section: "CONTROL",
        icon: <LogOut size={16} />,
        run: signOut,
      },
    ];

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    if (/^(ai|tag):/i.test(query)) return [];
    return items.filter((item) =>
      item.label.toLowerCase().includes(normalizedQuery),
    );
  }, [
    query,
    refreshWorkspace,
    signOut,
    syncing,
    triggerVoiceMonkey,
    openTasks,
  ]);

  const groupedPaletteItems = useMemo(
    () =>
      paletteItems.reduce<Record<PaletteItem["section"], PaletteItem[]>>(
        (acc, item) => {
          acc[item.section].push(item);
          return acc;
        },
        { "GO TO": [], STUDY: [], CONTROL: [] },
      ),
    [paletteItems],
  );

  const activeItemsCount = isDeckSearch
    ? filteredDecks.length
    : isNoteSearch
      ? filteredNotes.length
      : paletteItems.length;

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthError(error.message);
      return;
    }

    setSession(data.session);
    setPassword("");
    await refreshWorkspace();
  };

  const handlePaletteKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") closeWindow();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        Math.min(index + 1, Math.max(activeItemsCount - 1, 0)),
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === "Enter") {
      if (isDeckSearch && filteredDecks[activeIndex]) {
        openDeck(filteredDecks[activeIndex]);
      } else if (isNoteSearch && filteredNotes[activeIndex]) {
        setActiveNoteIndex(activeIndex);
      } else if (!isDeckSearch && paletteItems[activeIndex]) {
        paletteItems[activeIndex].run();
      }
    }
  };

  const handleSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    handlePaletteKey(event);
    if (!isNoteSearch) return;

    if (event.key === "ArrowDown") {
      setActiveNoteIndex((index) =>
        Math.min(index + 1, Math.max(filteredNotes.length - 1, 0)),
      );
    }
    if (event.key === "ArrowUp") {
      setActiveNoteIndex((index) => Math.max(index - 1, 0));
    }
  };

  const handleDeckKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      closeWindow();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveCardIndex((index) =>
        Math.min(index + 1, selectedDeckCards.length - 1),
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveCardIndex((index) => Math.max(index - 1, 0));
    }
  };

  if (loading) {
    return (
      <main className="app-shell compact">
        <div className="loading-row">
          <RefreshCw size={16} className="spin" />
          <span>Connecting workspace...</span>
        </div>
      </main>
    );
  }

  if (!session && !PREVIEW_MODE) {
    return (
      <main className="app-shell auth-shell">
        <form className="auth-card" onSubmit={handleAuth}>
          <div>
            <p className="eyebrow">Flashcards</p>
            <h1>Sign in</h1>
          </div>
          <input
            autoFocus
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email address"
            autoComplete="email"
          />
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />
          {authError && <p className="auth-error">{authError}</p>}
          <button className="primary-button" type="submit">
            <Check size={15} />
            Connect Account
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className={`app-shell${isAiMode ? " ai-glow" : ""}`}>
      <AnimatePresence mode="wait">
        {mode === "tasks" ? (
          <motion.section
            key="tasks"
            className="panel tasks-panel"
            initial={{ opacity: 0, x: 18, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -18, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <header className="search-row">
              <ListTodo size={17} />
              <button className="deck-pill" onClick={() => setMode("palette")}>
                <span>Tasks</span>
                <X size={12} />
              </button>
              <div style={{ flex: 1 }} />
              <button
                className="add-task-button"
                onClick={() => setShowAddTask(true)}
              >
                <Plus size={14} />
                Add Task
              </button>
              <Kbd>esc</Kbd>
            </header>

            <div className="tasks-body">
              <aside className="task-list-pane">
                <div className="sort-row">
                  <button
                    onClick={() =>
                      setTaskSortMode((current) =>
                        current === "due_date" ? "priority" : "due_date",
                      )
                    }
                  >
                    Sort:{" "}
                    {taskSortMode === "due_date" ? "Due Date" : "Priority"}
                    <ChevronDown size={12} />
                  </button>
                  <span>{sortedTasks.length} tasks</span>
                </div>
                <div className="task-list">
                  {sortedTasks.length === 0 ? (
                    <p className="empty-state">No tasks found.</p>
                  ) : (
                    sortedTasks.map((task, index) => (
                      <button
                        key={task.id}
                        className={`task-item ${index === activeTaskIndex ? "active" : ""} ${task.done ? "done" : ""}`}
                        onMouseEnter={() => setActiveTaskIndex(index)}
                        onClick={() => setActiveTaskIndex(index)}
                      >
                        <button
                          className="task-check"
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleTaskDone(task);
                          }}
                        >
                          {task.done ? (
                            <CheckCircle2 size={16} />
                          ) : (
                            <Circle size={16} />
                          )}
                        </button>
                        <span className="task-subject">
                          {task.subject || "Untitled task"}
                        </span>
                        {task.priority && task.priority >= 3 && (
                          <span className="priority-badge high">High</span>
                        )}
                        {task.priority === 2 && (
                          <span className="priority-badge medium">Med</span>
                        )}
                        {task.priority === 1 && (
                          <span className="priority-badge low">Low</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              </aside>

              <article className="task-preview">
                {activeTask ? (
                  <>
                    <div className="task-header">
                      <button
                        className={`task-check-large ${activeTask.done ? "done" : ""}`}
                        onClick={() => void toggleTaskDone(activeTask)}
                      >
                        {activeTask.done ? (
                          <CheckCircle2 size={24} />
                        ) : (
                          <Circle size={24} />
                        )}
                      </button>
                      <h2 className={activeTask.done ? "done" : ""}>
                        {activeTask.subject || "Untitled task"}
                      </h2>
                    </div>
                    <div className="task-details">
                      <div className="task-detail-row">
                        <Calendar size={14} />
                        <span>
                          {activeTask.due_date
                            ? new Date(activeTask.due_date).toLocaleDateString(
                                "en-US",
                                {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                },
                              )
                            : "No due date"}
                        </span>
                      </div>
                      <div className="task-detail-row">
                        <Tag size={14} />
                        <span>
                          Priority:{" "}
                          {activeTask.priority === 3
                            ? "High"
                            : activeTask.priority === 2
                              ? "Medium"
                              : activeTask.priority === 1
                                ? "Low"
                                : "None"}
                        </span>
                      </div>
                      {activeTask.done && (
                        <div className="task-completed-badge">
                          <Check size={14} />
                          <span>Completed</span>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="preview-placeholder">
                    Select a task to view details
                  </div>
                )}
              </article>
            </div>

            <footer className="footer-row">
              <div>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>Navigate</span>
              </div>
              <div>
                <Kbd>esc</Kbd>
                <span>Back</span>
              </div>
              <button
                className="ghost-button"
                onClick={() => setMode("palette")}
              >
                <ArrowLeft size={14} />
                Home
              </button>
            </footer>

            <AnimatePresence>
              {showAddTask && (
                <motion.div
                  className="add-task-overlay"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setShowAddTask(false)}
                >
                  <motion.div
                    className="add-task-modal"
                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                    transition={{ duration: 0.15 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3>Add New Task</h3>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Task subject..."
                      value={newTaskSubject}
                      onChange={(e) => setNewTaskSubject(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addTask();
                        if (e.key === "Escape") setShowAddTask(false);
                      }}
                    />
                    <input
                      type="datetime-local"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                    />
                    <div className="priority-selector">
                      <span>Priority:</span>
                      <button
                        className={newTaskPriority === 1 ? "selected" : ""}
                        onClick={() => setNewTaskPriority(1)}
                      >
                        Low
                      </button>
                      <button
                        className={newTaskPriority === 2 ? "selected" : ""}
                        onClick={() => setNewTaskPriority(2)}
                      >
                        Medium
                      </button>
                      <button
                        className={newTaskPriority === 3 ? "selected" : ""}
                        onClick={() => setNewTaskPriority(3)}
                      >
                        High
                      </button>
                    </div>
                    <div className="modal-actions">
                      <button
                        className="ghost-button"
                        onClick={() => setShowAddTask(false)}
                      >
                        Cancel
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => void addTask()}
                      >
                        <Plus size={14} />
                        Add Task
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.section>
        ) : mode === "deck" && selectedDeck ? (
          <motion.section
            key="deck"
            className="panel deck-panel"
            initial={{ opacity: 0, x: 18, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -18, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <header className="search-row">
              <Search size={17} />
              <button className="deck-pill" onClick={() => setMode("palette")}>
                <span>Deck:</span>
                <strong>{selectedDeck.name}</strong>
                <X size={12} />
              </button>
              <input
                ref={cardInputRef}
                value={cardQuery}
                onChange={(event) => setCardQuery(event.target.value)}
                onKeyDown={handleDeckKey}
                placeholder="Search cards..."
              />
              <Kbd>esc</Kbd>
            </header>

            <div className="deck-body">
              <aside className="card-list-pane">
                {currentTags.length > 0 && (
                  <div className="tag-strip">
                    <button
                      className={!selectedTag ? "selected" : ""}
                      onClick={() => setSelectedTag(null)}
                    >
                      All
                    </button>
                    {currentTags.map((tag) => (
                      <button
                        key={tag}
                        className={selectedTag === tag ? "selected" : ""}
                        onClick={() =>
                          setSelectedTag((current) =>
                            current === tag ? null : tag,
                          )
                        }
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
                <div className="sort-row">
                  <button
                    onClick={() =>
                      setSortMode((current) =>
                        current === "created" ? "alphabetic" : "created",
                      )
                    }
                  >
                    Sort: {sortMode === "created" ? "Created" : "Alphabetic"}
                    <ChevronDown size={12} />
                  </button>
                  <span>{selectedDeckCards.length} cards</span>
                </div>
                <div className="card-list">
                  {selectedDeckCards.length === 0 ? (
                    <p className="empty-state">No cards found.</p>
                  ) : (
                    selectedDeckCards.map((card, index) => (
                      <button
                        key={card.id}
                        className={index === activeCardIndex ? "active" : ""}
                        onMouseEnter={() => setActiveCardIndex(index)}
                        onClick={() => setActiveCardIndex(index)}
                      >
                        <BookOpen size={15} />
                        <span>{card.front || "Untitled card"}</span>
                      </button>
                    ))
                  )}
                </div>
              </aside>

              <article className="card-preview">
                {activeCard ? (
                  <>
                    <div>
                      <p className="preview-label">Front</p>
                      <div className="preview-front">{activeCard.front}</div>
                    </div>
                    <hr />
                    <div>
                      <p className="preview-label">Back</p>
                      <div className="preview-back">{activeCard.back}</div>
                    </div>
                    {activeCard.front_img_url && (
                      <img src={activeCard.front_img_url} alt="" />
                    )}
                    {tagsFromCard(activeCard).length > 0 && (
                      <div className="preview-tags">
                        {tagsFromCard(activeCard).map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="preview-placeholder">
                    Select a card to preview
                  </div>
                )}
              </article>
            </div>

            <footer className="footer-row">
              <div>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>Navigate</span>
              </div>
              <div>
                <Kbd>esc</Kbd>
                <span>Back</span>
              </div>
              <button
                className="ghost-button"
                onClick={() => setMode("palette")}
              >
                <ArrowLeft size={14} />
                Decks
              </button>
            </footer>
          </motion.section>
        ) : (
          <motion.section
            key="palette"
            className="panel palette-panel"
            initial={{ opacity: 0, x: -18, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 18, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <header className="search-row">
              <Search size={17} />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleSearchKey}
                placeholder="Search decks, cards, or actions..."
              />
              <button
                className="token-button"
                onClick={() => setQuery("deck:")}
              >
                deck:
              </button>
              <button
                className="token-button"
                onClick={() => setQuery("notes:")}
              >
                notes:
              </button>
              <button className="token-button" onClick={() => setQuery("tag:")}>
                tag:
              </button>
              <Kbd>esc</Kbd>
            </header>

            <section className="result-list">
              {isDeckSearch ? (
                <>
                  <p className="section-title">Decks</p>
                  {filteredDecks.length === 0 ? (
                    <p className="empty-state">No decks found.</p>
                  ) : (
                    filteredDecks.map((deck, index) => {
                      const deckCards = cardsForDeck(cards, deck.id);
                      return (
                        <button
                          key={deck.id}
                          className={index === activeIndex ? "active" : ""}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => openDeck(deck)}
                        >
                          <Library size={16} />
                          <span>{deck.name}</span>
                          <small>{deckCards.length} cards</small>
                        </button>
                      );
                    })
                  )}
                </>
              ) : isNoteSearch ? (
                <div className="notes-explorer">
                  <aside className="notes-sidebar">
                    <div className="notes-count">
                      {filteredNotes.length} notes
                    </div>
                    <div className="notes-list">
                      {filteredNotes.length === 0 ? (
                        <p className="empty-state">No notes found.</p>
                      ) : (
                        filteredNotes.map((note, index) => (
                          <button
                            key={note.id}
                            className={
                              index === activeNoteIndex ? "active" : ""
                            }
                            onMouseEnter={() => {
                              setActiveIndex(index);
                              setActiveNoteIndex(index);
                            }}
                            onClick={() => {
                              setActiveIndex(index);
                              setActiveNoteIndex(index);
                            }}
                          >
                            <FileText size={15} />
                            <span>{note.title || "Untitled note"}</span>
                            {note.is_starred && <small>Starred</small>}
                          </button>
                        ))
                      )}
                    </div>
                  </aside>
                  <article className="note-preview">
                    {activeNote ? (
                      <>
                        <div className="note-kicker">
                          <span>{activeNote.category}</span>
                          <span>{activeNote.project}</span>
                        </div>
                        <h1>{activeNote.title}</h1>
                        <div className="markdown-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {activeNote.content}
                          </ReactMarkdown>
                        </div>
                      </>
                    ) : (
                      <div className="preview-placeholder">
                        Select a note to preview
                      </div>
                    )}
                  </article>
                </div>
              ) : paletteItems.length === 0 ? (
                <p className="empty-state">No actions found.</p>
              ) : (
                (
                  Object.keys(groupedPaletteItems) as PaletteItem["section"][]
                ).map(
                  (section) =>
                    groupedPaletteItems[section].length > 0 && (
                      <div key={section}>
                        <p className="section-title">{section}</p>
                        {groupedPaletteItems[section].map((item) => {
                          const globalIndex = paletteItems.findIndex(
                            (candidate) => candidate.id === item.id,
                          );
                          return (
                            <button
                              key={item.id}
                              className={
                                globalIndex === activeIndex ? "active" : ""
                              }
                              onMouseEnter={() => setActiveIndex(globalIndex)}
                              onClick={item.run}
                            >
                              {item.icon}
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ),
                )
              )}
            </section>

            <footer className="footer-row">
              <div>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
                <span>Navigate</span>
              </div>
              <div>
                <Kbd>↵</Kbd>
                <span>Open</span>
              </div>
              <div className="status">
                <Tag size={13} />
                <span>
                  {session?.user?.email || (PREVIEW_MODE ? "Preview Mode" : "")}
                </span>
              </div>
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}
