import {
  ArrowLeft,
  BarChart2,
  BookOpen,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Download,
  FileText,
  Home,
  Library,
  Lightbulb,
  LightbulbOff,
  ListTodo,
  LogOut,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SkipForward,
  Tag,
  Timer,
  X,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
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

type ViewMode = "palette" | "deck" | "tasks" | "pomodoro";

type PomodoroPhase = "work" | "short-break" | "long-break";

const POMODORO_DURATIONS: Record<PomodoroPhase, number> = {
  "work": 25 * 60,
  "short-break": 5 * 60,
  "long-break": 15 * 60,
};

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
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // Pomodoro state
  const [pomodoroPhase, setPomodoroPhase] = useState<PomodoroPhase>("work");
  const [pomodoroSecondsLeft, setPomodoroSecondsLeft] = useState(
    POMODORO_DURATIONS["work"],
  );
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroSession, setPomodoroSession] = useState(0); // completed work sessions
  const pomodoroIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    // Ctrl+K to focus search bar
    const handleCtrlK = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "k") {
        event.preventDefault();
        if (mode === "palette") {
          inputRef.current?.focus();
        } else if (mode === "deck") {
          cardInputRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleEscape);
    window.addEventListener("keydown", handleCtrlK);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("keydown", handleCtrlK);
    };
  }, [mode, showAddTask]);

  // Pomodoro tick
  useEffect(() => {
    if (pomodoroRunning) {
      pomodoroIntervalRef.current = setInterval(() => {
        setPomodoroSecondsLeft((s) => {
          if (s <= 1) {
            // Phase complete — auto-advance
            setPomodoroRunning(false);
            setPomodoroPhase((phase) => {
              if (phase === "work") {
                let nextPhase: PomodoroPhase = "short-break";
                setPomodoroSession((n) => {
                  const next = n + 1;
                  nextPhase = next % 4 === 0 ? "long-break" : "short-break";
                  setPomodoroSecondsLeft(POMODORO_DURATIONS[nextPhase]);
                  return next;
                });
                return nextPhase;
              } else {
                setPomodoroSecondsLeft(POMODORO_DURATIONS["work"]);
                return "work";
              }
            });
            // Play a subtle beep via AudioContext
            try {
              const ctx = new AudioContext();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = 880;
              gain.gain.setValueAtTime(0.18, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
              osc.start();
              osc.stop(ctx.currentTime + 0.7);
            } catch (_) {/* no audio permission */}
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (pomodoroIntervalRef.current)
        clearInterval(pomodoroIntervalRef.current);
    }
    return () => {
      if (pomodoroIntervalRef.current)
        clearInterval(pomodoroIntervalRef.current);
    };
  }, [pomodoroRunning]);

  const pomodoroReset = useCallback((phase?: PomodoroPhase) => {
    setPomodoroRunning(false);
    const p = phase ?? pomodoroPhase;
    setPomodoroPhase(p);
    setPomodoroSecondsLeft(POMODORO_DURATIONS[p]);
  }, [pomodoroPhase]);

  const pomodoroSkip = useCallback(() => {
    setPomodoroRunning(false);
    setPomodoroPhase((phase) => {
      const next: PomodoroPhase =
        phase === "work"
          ? (pomodoroSession + 1) % 4 === 0
            ? "long-break"
            : "short-break"
          : "work";
      setPomodoroSecondsLeft(POMODORO_DURATIONS[next]);
      return next;
    });
  }, [pomodoroSession]);

  const openPomodoro = useCallback(() => {
    setMode("pomodoro");
  }, []);

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

  const closeWindow = useCallback(async () => {
    try {
      await invoke("hide_to_tray");
    } catch (_) { /* non-Tauri environment */ }
    setMode("palette");
    setQuery("");
  }, []);

  // Escape → hide window when in pomodoro mode (palette/deck handled by their key handlers)
  useEffect(() => {
    if (mode !== "pomodoro") return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { void closeWindow(); e.preventDefault(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mode, closeWindow]);

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

  const pomodoroMinutes = Math.floor(pomodoroSecondsLeft / 60);
  const pomodoroSeconds = pomodoroSecondsLeft % 60;

  // Split-circle ring calculations
  const RING_R = 54;
  const RING_STROKE = 8;
  const RING_CIRC = 2 * Math.PI * RING_R;
  const GAP_ARC = (6 / 360) * RING_CIRC; // 6° visual gap between arcs
  const currentBreakDuration =
    (pomodoroSession + 1) % 4 === 0
      ? POMODORO_DURATIONS["long-break"]
      : POMODORO_DURATIONS["short-break"];
  const cycleDuration = POMODORO_DURATIONS["work"] + currentBreakDuration;
  const workArcLen = (POMODORO_DURATIONS["work"] / cycleDuration) * RING_CIRC - GAP_ARC;
  const breakArcLen = (currentBreakDuration / cycleDuration) * RING_CIRC - GAP_ARC;
  const progressArcLen =
    pomodoroPhase === "work"
      ? (pomodoroSecondsLeft / POMODORO_DURATIONS["work"]) * workArcLen
      : (pomodoroSecondsLeft / currentBreakDuration) * breakArcLen;

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

  const queryGroq = useCallback(async (prompt: string) => {
    console.log("AI query triggered with prompt:", prompt);
    setAiLoading(true);
    setAiResponse("");

    const apiKey = import.meta.env.VITE_GROQ_KEY || import.meta.env.GROQ_KEY;
    console.log("API key available:", !!apiKey);

    if (!apiKey) {
      console.error("No API key found");
      setAiResponse("Error: No GROQ_API_KEY found in environment variables.");
      setAiLoading(false);
      return;
    }

    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-120b",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          stream: true,
        }),
      });

      console.log("Response status:", response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Groq API error response:", errorText);
        throw new Error(`Groq API error: ${response.statusText} - ${errorText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No reader available");
      }

      const decoder = new TextDecoder();
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                setAiResponse(fullResponse);
              }
            } catch (e) {
              // Ignore parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      console.error("Groq API error:", error);
      setAiResponse(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAiLoading(false);
    }
  }, []);

  const checkForUpdates = useCallback(async () => {
    try {
      setCheckingUpdate(true);
      const update = await check();

      if (!update) {
        alert("You have the latest version (0.5.2).");
        return;
      }

      const shouldInstall = confirm(
        `Update available: ${update.version || "latest"}\n\nRelease notes:\n${update.body || "No release notes available."}\n\nWould you like to install now?`,
      );

      if (shouldInstall) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (error) {
      console.error("Update check failed:", error);
      alert("You have the latest version (0.5.2).");
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

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
        id: "pomodoro",
        label: "Pomodoro Timer",
        section: "GO TO",
        icon: <Timer size={16} />,
        run: openPomodoro,
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
        id: "check-update",
        label: checkingUpdate ? "Checking..." : "Check for Updates",
        section: "CONTROL",
        icon: <Download size={16} className={checkingUpdate ? "spin" : ""} />,
        run: () => void checkForUpdates(),
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
    openPomodoro,
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
    if (event.key === "Enter" && isAiMode) {
      const prompt = query.replace(/^ai:\s*/i, "").trim();
      console.log("Enter pressed in AI mode, prompt:", prompt);
      if (prompt) {
        void queryGroq(prompt);
      }
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
        {mode === "pomodoro" ? (
          <motion.section
            key="pomodoro"
            className="panel pomodoro-panel"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.16 }}
          >
            <div className="pomodoro-body">
              {/* Split-circle ring: focus arc + break arc */}
              <div className="pomodoro-ring-wrap">
                <svg
                  className="pomodoro-ring"
                  viewBox="0 0 128 128"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  {/* Focus section background */}
                  <circle
                    cx="64"
                    cy="64"
                    r={RING_R}
                    fill="none"
                    className="arc-section-work"
                    strokeWidth={RING_STROKE}
                    strokeDasharray={`${workArcLen} ${RING_CIRC}`}
                    strokeDashoffset={0}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
                  />
                  {/* Break section background */}
                  <circle
                    cx="64"
                    cy="64"
                    r={RING_R}
                    fill="none"
                    className="arc-section-break"
                    strokeWidth={RING_STROKE}
                    strokeDasharray={`${breakArcLen} ${RING_CIRC}`}
                    strokeDashoffset={-(workArcLen + GAP_ARC)}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
                  />
                  {/* Progress arc — remaining time in current phase */}
                  <circle
                    cx="64"
                    cy="64"
                    r={RING_R}
                    fill="none"
                    className="arc-progress"
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${progressArcLen} ${RING_CIRC}`}
                    strokeDashoffset={pomodoroPhase === "work" ? 0 : -(workArcLen + GAP_ARC)}
                    style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
                  />
                </svg>
                <div className="pomodoro-time">
                  <span className="pomodoro-digits">
                    {String(pomodoroMinutes).padStart(2, "0")}:{String(pomodoroSeconds).padStart(2, "0")}
                  </span>
                  <span className="pomodoro-phase-label">
                    {pomodoroPhase === "work"
                      ? "Focus"
                      : pomodoroPhase === "short-break"
                        ? "Break"
                        : "Long Break"}
                  </span>
                </div>
              </div>

              {/* Controls */}
              <div className="pomodoro-controls">
                <button
                  className="pomodoro-ctrl-btn"
                  onClick={() => pomodoroReset()}
                  title="Reset"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  className="pomodoro-play-btn"
                  onClick={() => setPomodoroRunning((r) => !r)}
                >
                  {pomodoroRunning ? <Pause size={22} /> : <Play size={22} />}
                </button>
                <button
                  className="pomodoro-ctrl-btn"
                  onClick={pomodoroSkip}
                  title="Skip"
                >
                  <SkipForward size={16} />
                </button>
              </div>
            </div>

            <footer className="footer-row">
              <div>
                <Kbd>esc</Kbd>
                <span>Hide</span>
              </div>
              <button
                className="ghost-button"
                onClick={() => setMode("palette")}
              >
                <ArrowLeft size={14} />
                Home
              </button>
            </footer>
          </motion.section>
        ) : mode === "tasks" ? (
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
              {isAiMode ? (
                <>
                  {aiLoading && (
                    <div className="ai-loading">
                      <RefreshCw size={16} className="spin" />
                      <span>Thinking...</span>
                    </div>
                  )}
                  {aiResponse && (
                    <div className="ai-response">
                      <div className="markdown-body">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {aiResponse}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )}
                </>
              ) : isDeckSearch ? (
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
