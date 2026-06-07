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
  FilePenLine,
  FileText,
  Home,
  LayoutGrid,
  Library,
  Lightbulb,
  LightbulbOff,
  ListTodo,
  LogOut,
  Palette,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SkipForward,
  StickyNote,
  Tag,
  Timer,
  X,
  Music,
} from "lucide-react";
import type { NoteEditorPayload } from "./AddNoteView";
import { SpotifyPanel } from "./SpotifyPanel";
import { CalendarEvent, CalendarView } from "./CalendarView";
import { MoodboardPanel } from "./MoodboardPanel";
import { StudyView, type StudyCard } from "./StudyView";
import { ThemeSettings } from "./ThemeSettings";
import { CardProgressRow, FsrsStateJson, isCardDue } from "./lib/fsrs";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { AnimatePresence, motion } from "framer-motion";
import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Logtail } from "@logtail/browser";
import {
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const AddNoteView = lazy(() =>
  import("./AddNoteView").then((module) => ({ default: module.AddNoteView })),
);

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const LOGTAIL_TOKEN = (
  import.meta.env.VITE_BETTERSTACK_SOURCE_TOKEN ?? ""
).trim();

type ClientLogger = {
  error: (message: string) => void;
};

function createClientLogger(): ClientLogger {
  if (!LOGTAIL_TOKEN) {
    return {
      error(message: string) {
        console.error(message);
      },
    };
  }

  try {
    return new Logtail(LOGTAIL_TOKEN);
  } catch (error) {
    console.warn("Logtail disabled:", error);
    return {
      error(message: string) {
        console.error(message);
      },
    };
  }
}

const clientLogger = createClientLogger();
const AI_SIDECAR_URL =
  import.meta.env.VITE_AI_SIDECAR_URL || "http://127.0.0.1:8788";
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
  exclude_from_srs?: boolean | null;
};

type Card = {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  tag?: string | null;
  front_img_url?: string | null;
  back_img_url?: string | null;
  exclude_from_srs?: boolean | null;
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

type ViewMode =
  | "palette"
  | "deck"
  | "tasks"
  | "calendar"
  | "pomodoro"
  | "theme"
  | "study"
  | "moodboard"
  | "add-note"
  | "spotify";

type PomodoroPhase = "work" | "short-break" | "long-break";

const POMODORO_DURATIONS: Record<PomodoroPhase, number> = {
  work: 25 * 60,
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

const supabase: SupabaseClient | null = SUPABASE_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

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

function shuffleCards<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function fetchAllRows<T>(query: any): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await query.range(
      page * pageSize,
      (page + 1) * pageSize - 1,
    );
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    page++;
  }
  return all;
}

export function DecksActionSearchBar() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const studiedCardIdsRef = useRef<Set<string>>(new Set());
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [cardProgress, setCardProgress] = useState<CardProgressRow[]>([]);
  const [studyPickMode, setStudyPickMode] = useState(false);
  const [studyDeck, setStudyDeck] = useState<Deck | null>(null);
  const [studyCards, setStudyCards] = useState<StudyCard[]>([]);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
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
  const pomodoroIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const animationRef = useRef<number | null>(null);
  const currentSizeRef = useRef({ width: 680, height: 600 });

  const animateWindowSize = useCallback(
    (targetWidth: number, targetHeight: number) => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      const startWidth = currentSizeRef.current.width;
      const startHeight = currentSizeRef.current.height;
      const duration = 250; // ms transition duration
      const startTime = performance.now();

      const step = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // easeOutCubic easing for ultra-premium and smooth feeling
        const ease = 1 - Math.pow(1 - progress, 3);

        const currentWidth = Math.round(
          startWidth + (targetWidth - startWidth) * ease,
        );
        const currentHeight = Math.round(
          startHeight + (targetHeight - startHeight) * ease,
        );

        currentSizeRef.current = { width: currentWidth, height: currentHeight };
        try {
          invoke("set_window_size", {
            width: currentWidth,
            height: currentHeight,
            center: true,
          });
        } catch (err) {
          console.error("Error setting window size:", err);
          // Log to Logtail for client-side error monitoring
          clientLogger.error(
            `Window resize error: ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        if (progress < 1) {
          animationRef.current = requestAnimationFrame(step);
        } else {
          animationRef.current = null;
        }
      };

      animationRef.current = requestAnimationFrame(step);
    },
    [],
  );

  useEffect(
    () => () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    },
    [],
  );

  const progressByCardId = useMemo(() => {
    const map = new Map<string, CardProgressRow>();
    for (const row of cardProgress) {
      map.set(String(row.card_id), row);
    }
    return map;
  }, [cardProgress]);

  const refreshWorkspace = useCallback(async () => {
    if (!supabase) return;
    setSyncing(true);
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const progressQuery = userId
        ? supabase.from("card_progress").select("*").eq("user_id", userId)
        : null;

      const [
        deckRows,
        cardRows,
        noteRows,
        taskRows,
        calendarRows,
        progressRows,
      ] = await Promise.all([
        fetchAllRows<Deck>(supabase.from("decks").select("*")),
        fetchAllRows<Card>(supabase.from("cards").select("*")),
        fetchAllRows<Note>(
          supabase
            .from("notes")
            .select("*")
            .order("updated_at", { ascending: false }),
        ),
        fetchAllRows<Task>(
          supabase
            .from("homework")
            .select("*")
            .order("due_date", { ascending: true }),
        ),
        fetchAllRows<CalendarEvent>(
          supabase
            .from("calendar_events")
            .select("*")
            .order("starts_at", { ascending: true }),
        ),
        progressQuery
          ? fetchAllRows<CardProgressRow>(progressQuery)
          : Promise.resolve([] as CardProgressRow[]),
      ]);

      setDecks(deckRows);
      setCards(cardRows);
      // Filter progress to only include entries for cards that exist
      const validCardIds = new Set(cardRows.map(c => String(c.id)));
      const validProgressRows = progressRows.filter(p => validCardIds.has(String(p.card_id)));
      console.log("Progress filtering:", { totalProgress: progressRows.length, validProgress: validProgressRows.length, filteredOut: progressRows.length - validProgressRows.length, sampleValidCardIds: Array.from(validCardIds).slice(0, 5), sampleProgressCardIds: progressRows.slice(0, 5).map(p => p.card_id) });
      // Log progress for all studied cards to see if they were fetched
      const studiedCardProgresses = Array.from(studiedCardIdsRef.current).map(cardId => ({
        cardId,
        progress: validProgressRows.find(p => String(p.card_id) === cardId)
      }));
      console.log("Studied card progress after refresh:", studiedCardProgresses);
      setCardProgress(validProgressRows);
      setNotes(noteRows);
      setTasks(taskRows);
      setCalendarEvents(calendarRows);
    } catch (error) {
      console.error("Error refreshing workspace:", error);
      clientLogger.error(
        `Workspace refresh error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

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
              gain.gain.exponentialRampToValueAtTime(
                0.001,
                ctx.currentTime + 0.7,
              );
              osc.start();
              osc.stop(ctx.currentTime + 0.7);
            } catch (_) {
              /* no audio permission */
            }
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

  const pomodoroReset = useCallback(
    (phase?: PomodoroPhase) => {
      setPomodoroRunning(false);
      const p = phase ?? pomodoroPhase;
      setPomodoroPhase(p);
      setPomodoroSecondsLeft(POMODORO_DURATIONS[p]);
    },
    [pomodoroPhase],
  );

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

  const openTheme = useCallback(() => {
    setMode("theme");
  }, []);

  const openMoodboard = useCallback(() => {
    setMode("moodboard");
  }, []);

  const openSpotify = useCallback(() => {
    setMode("spotify");
  }, []);

  const expandWindowLikeCalendar = useCallback(async () => {
    try {
      const size = await invoke<{ width: number; height: number }>(
        "get_expanded_window_size",
        { percent: 80 },
      );
      animateWindowSize(size.width, size.height);
    } catch {
      animateWindowSize(1200, 860);
    }
  }, [animateWindowSize]);

  const exitAddNote = useCallback(() => {
    setEditingNote(null);
    setMode("palette");
    animateWindowSize(680, 600);
  }, [animateWindowSize]);

  const openAddNote = useCallback(
    async (note?: Note | null) => {
      setEditingNote(note ?? null);
      await expandWindowLikeCalendar();
      setMode("add-note");
    },
    [expandWindowLikeCalendar],
  );

  const saveNote = useCallback(
    async (payload: NoteEditorPayload) => {
      if (!supabase || !session?.user?.id) {
        throw new Error("Sign in to save notes.");
      }

      const row = {
        title: payload.title,
        content: payload.content,
        category: payload.category,
        project: payload.project,
        is_starred: payload.is_starred,
        status: payload.status ?? null,
        user_id: session.user.id,
        updated_at: new Date().toISOString(),
      };

      const { error } = payload.id
        ? await supabase.from("notes").update(row).eq("id", payload.id)
        : await supabase.from("notes").insert(row);

      if (error) {
        clientLogger.error(`Note save error: ${error.message}`);
        throw new Error(error.message);
      }

      await refreshWorkspace();
      exitAddNote();
    },
    [exitAddNote, refreshWorkspace, session],
  );

  const noteCategorySuggestions = useMemo(
    () =>
      Array.from(
        new Set(notes.map((note) => note.category).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b)),
    [notes],
  );

  const openCalendar = useCallback(async () => {
    await expandWindowLikeCalendar();
    setMode("calendar");
  }, [expandWindowLikeCalendar]);

  const buildStudyQueue = useCallback(
    (deck: Deck) => {
      if (deck.exclude_from_srs) return [] as StudyCard[];
      const deckCards = cardsForDeck(cards, deck.id).filter(
        (card) => !card.exclude_from_srs,
      );
      const dueCards = deckCards.filter((card) =>
        isCardDue(progressByCardId.get(card.id)),
      );
      return shuffleCards(dueCards).map((card) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        front_img_url: card.front_img_url,
        back_img_url: card.back_img_url,
      }));
    },
    [cards, progressByCardId],
  );

  const startStudy = useCallback(
    async (deck: Deck) => {
      setStudyPickMode(false);
      setStudyDeck(deck);
      const studyQueue = buildStudyQueue(deck);
      setStudyCards(studyQueue);
      await expandWindowLikeCalendar();
      setMode("study");
      setQuery("");
      studiedCardIdsRef.current = new Set(); // Clear studied card IDs when starting new session

      // Debug logging when starting study
      const deckCards = cardsForDeck(cards, deck.id);
      console.log("Study started:", { deckName: deck.name, deckCardsCount: deckCards.length, studyQueueCount: studyQueue.length, cardProgressCount: cardProgress.length, sampleCardIds: deckCards.slice(0, 3).map(c => c.id), sampleProgressCardIds: cardProgress.slice(0, 3).map(p => p.card_id) });
    },
    [buildStudyQueue, expandWindowLikeCalendar, cards, cardProgress],
  );

  const openStudyDeckPicker = useCallback(async () => {
    setStudyPickMode(true);
    setQuery("decks:");
    setActiveIndex(0);
    setMode("palette");
    await expandWindowLikeCalendar();
    setTimeout(() => inputRef.current?.focus(), 20);
  }, [expandWindowLikeCalendar]);

  const exitStudy = useCallback(async () => {
    setStudyDeck(null);
    setStudyCards([]);
    setMode("palette");
    setQuery("");
    animateWindowSize(680, 600);
    // Add a small delay to allow database transaction to commit
    await new Promise(resolve => setTimeout(resolve, 500));
    await refreshWorkspace();
  }, [animateWindowSize, refreshWorkspace]);

  const saveCardProgress = useCallback(
    async (cardId: string, fsrsState: FsrsStateJson, dueDate: string) => {
      if (!supabase || !session?.user?.id) return;
      const numericCardId = Number(cardId);
      const row = {
        card_id: numericCardId,
        user_id: session.user.id,
        due_date: dueDate,
        last_reviewed: new Date().toISOString(),
        fsrs_state: fsrsState,
      };

      console.log("saveCardProgress: attempting to save", { cardId, numericCardId, dueDate, fsrsState });

      const { error, data } = await supabase.from("card_progress").upsert(row, {
        onConflict: "card_id,user_id",
      }).select();

      if (error) {
        clientLogger.error(`Card progress save error: ${error.message}`);
        console.error("Error saving card progress:", error);
        return;
      }

      console.log("Card progress saved successfully:", { cardId, dueDate, fsrsState, data });

      // Use the ID returned from the database upsert
      const dbId = data && data.length > 0 ? data[0].id : 0;

      // Track studied card IDs
      studiedCardIdsRef.current.add(cardId);

      setCardProgress((prev) => {
        const existing = prev.findIndex(
          (p) => String(p.card_id) === cardId && p.user_id === session.user.id,
        );
        const nextRow: CardProgressRow = {
          id: existing >= 0 ? prev[existing].id : dbId,
          card_id: numericCardId,
          user_id: session.user.id,
          due_date: dueDate,
          last_reviewed: row.last_reviewed,
          fsrs_state: fsrsState,
          ease_factor: existing >= 0 ? prev[existing].ease_factor : 2.5,
          interval: existing >= 0 ? prev[existing].interval : 0,
          repetitions: existing >= 0 ? prev[existing].repetitions : 0,
          created_at: existing >= 0 ? prev[existing].created_at : new Date().toISOString(),
          updated_at: new Date().toISOString(),
          fsrs_params: existing >= 0 ? prev[existing].fsrs_params : null,
        };
        console.log("saveCardProgress: updating local state", { cardId, existing, dbId, nextRow });
        if (existing >= 0) {
          const copy = [...prev];
          copy[existing] = nextRow;
          return copy;
        }
        return [...prev, nextRow];
      });
    },
    [session],
  );

  useEffect(() => {
    if (mode === "palette") {
      setTimeout(() => inputRef.current?.focus(), 20);
    } else if (mode === "tasks") {
      animateWindowSize(780, 720);
    } else if (
      mode === "calendar" ||
      mode === "study" ||
      mode === "pomodoro" ||
      mode === "theme" ||
      mode === "moodboard" ||
      mode === "add-note" ||
      mode === "spotify"
    ) {
      /* size handled when opening those views */
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
  const isThemeMode = /^theme:\s*/i.test(query);

  useEffect(() => {
    if (mode === "theme") {
      animateWindowSize(500, 550);
    } else if (mode === "moodboard") {
      animateWindowSize(480, 520);
    } else if (mode === "spotify") {
      animateWindowSize(450, 520);
    } else if (mode !== "palette") return;
    const contentWidth = isNoteSearch ? 900 : isDeckSearch ? 780 : 680;
    const contentHeight = isNoteSearch ? 884 : isDeckSearch ? 720 : 600;
    const glowGutter = isAiMode ? 48 : 0;

    animateWindowSize(contentWidth + glowGutter, contentHeight + glowGutter);
  }, [animateWindowSize, isAiMode, isNoteSearch, isDeckSearch, mode]);

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
    if (isThemeMode && mode !== "theme") {
      setMode("theme");
    }
  }, [query, isThemeMode, mode]);

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
    setStudyPickMode(false);
    setSelectedDeck(deck);
    setMode("deck");
    setCardQuery("");
    setSelectedTag(null);
    setActiveCardIndex(0);

    // Debug logging when deck is selected
    const deckCards = cardsForDeck(cards, deck.id);
    console.log("Deck selected:", { deckName: deck.name, deckCardsCount: deckCards.length, cardProgressCount: cardProgress.length, sampleCardIds: deckCards.slice(0, 3).map(c => c.id), sampleProgressCardIds: cardProgress.slice(0, 3).map(p => p.card_id) });
  }, [cards, cardProgress]);

  const selectDeckFromSearch = useCallback(
    (deck: Deck) => {
      if (studyPickMode) {
        void startStudy(deck);
        return;
      }
      openDeck(deck);
    },
    [openDeck, startStudy, studyPickMode],
  );

  const closeWindow = useCallback(async () => {
    try {
      await invoke("hide_to_tray");
    } catch (_) {
      /* non-Tauri environment */
    }
    setStudyPickMode(false);
    setMode("palette");
    setQuery("");
  }, []);

  // Escape → hide window when in pomodoro/calendar/spotify (study/palette/deck use their own handlers)
  useEffect(() => {
    if (mode !== "pomodoro" && mode !== "calendar" && mode !== "spotify")
      return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        void closeWindow();
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [mode, closeWindow]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
    setDecks([]);
    setCards([]);
    setNotes([]);
    setTasks([]);
    setCalendarEvents([]);
    setMode("palette");
  }, []);

  const triggerVoiceMonkey = useCallback(async (url: string) => {
    await fetch(url, { method: "GET" });
  }, []);

  const openStickyNote = useCallback(async () => {
    try {
      await invoke("open_sticky_note");
    } catch (error) {
      console.error("Failed to open sticky note:", error);
    }
  }, []);

  const openTasks = useCallback(() => {
    setMode("tasks");
    setActiveTaskIndex(0);
  }, []);

  const saveCalendarEvent = useCallback(
    async (payload: {
      id?: string;
      title: string;
      description: string;
      starts_at: string;
      ends_at: string | null;
      all_day: boolean;
    }) => {
      if (!supabase) return;
      const row = {
        title: payload.title,
        description: payload.description || null,
        starts_at: payload.starts_at,
        ends_at: payload.ends_at,
        all_day: payload.all_day,
      };

      const { error } = payload.id
        ? await supabase
            .from("calendar_events")
            .update(row)
            .eq("id", payload.id)
        : await supabase.from("calendar_events").insert(row);

      if (error) {
        clientLogger.error(`Calendar event save error: ${error.message}`);
        console.error("Error saving calendar event:", error);
        return;
      }

      await refreshWorkspace();
    },
    [refreshWorkspace],
  );

  const deleteCalendarEvent = useCallback(
    async (id: string) => {
      if (!supabase) return;
      const { error } = await supabase
        .from("calendar_events")
        .delete()
        .eq("id", id);

      if (error) {
        clientLogger.error(`Calendar event delete error: ${error.message}`);
        console.error("Error deleting calendar event:", error);
        return;
      }

      await refreshWorkspace();
    },
    [refreshWorkspace],
  );

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
  const workArcLen =
    (POMODORO_DURATIONS["work"] / cycleDuration) * RING_CIRC - GAP_ARC;
  const breakArcLen =
    (currentBreakDuration / cycleDuration) * RING_CIRC - GAP_ARC;
  const progressArcLen =
    pomodoroPhase === "work"
      ? (pomodoroSecondsLeft / POMODORO_DURATIONS["work"]) * workArcLen
      : (pomodoroSecondsLeft / currentBreakDuration) * breakArcLen;

  const addTask = useCallback(async () => {
    if (!newTaskSubject.trim() || !supabase) return;

    const { error } = await supabase.from("homework").insert({
      subject: newTaskSubject.trim(),
      due_date: newTaskDueDate || null,
      priority: newTaskPriority,
      done: false,
    });
    if (error) {
      clientLogger.error(`Task creation error: ${error.message}`);
      console.error("Error creating task:", error);
    }

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
      if (!supabase) return;
      await supabase
        .from("homework")
        .update({ done: !task.done })
        .eq("id", task.id);
      await refreshWorkspace();
    },
    [refreshWorkspace],
  );

  const buildAiContext = useCallback(() => {
    const deckSummaries = decks.slice(0, 20).map((deck) => ({
      name: deck.name,
      description: deck.description,
      cardCount: cardsForDeck(cards, deck.id).length,
    }));

    const cardSummaries = cards.slice(0, 60).map((card) => ({
      front: card.front,
      back: card.back,
      tag: card.tag,
    }));

    const noteSummaries = notes.slice(0, 20).map((note) => ({
      title: note.title,
      content: note.content.slice(0, 900),
      category: note.category,
      project: note.project,
      status: note.status,
    }));

    const taskSummaries = tasks.slice(0, 20).map((task) => ({
      subject: task.subject,
      due_date: task.due_date,
      priority: task.priority,
      done: task.done,
    }));

    return {
      decks: deckSummaries,
      cards: cardSummaries,
      notes: noteSummaries,
      tasks: taskSummaries,
    };
  }, [cards, decks, notes, tasks]);

  const queryMastraAgent = useCallback(
    async (prompt: string) => {
      console.log("AI query triggered with prompt:", prompt);
      setAiLoading(true);
      setAiResponse("");

      try {
        const response = await fetch(`${AI_SIDECAR_URL}/ai`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt,
            context: buildAiContext(),
          }),
        });

        console.log("AI sidecar response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          const errorMessage = `Mastra AI error: ${response.statusText} - ${errorText}`;
          clientLogger.error(errorMessage);
          console.error("Mastra AI error response:", errorText);
          throw new Error(errorMessage);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          const errMsg = "No reader available";
          clientLogger.error(errMsg);
          throw new Error(errMsg);
        }

        const decoder = new TextDecoder();
        let fullResponse = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          fullResponse += decoder.decode(value, { stream: true });
          setAiResponse(fullResponse);
        }
      } catch (error) {
        clientLogger.error(
          `Mastra AI error: ${error instanceof Error ? error.message : String(error)}`,
        );
        console.error("Mastra AI error:", error);
        setAiResponse(
          `Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        setAiLoading(false);
      }
    },
    [buildAiContext],
  );

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
        id: "add-note",
        label: "Add Note",
        section: "GO TO",
        icon: <FilePenLine size={16} />,
        run: () => void openAddNote(),
      },
      {
        id: "tasks",
        label: "Tasks",
        section: "GO TO",
        icon: <ListTodo size={16} />,
        run: openTasks,
      },
      {
        id: "calendar",
        label: "Calendar",
        section: "GO TO",
        icon: <Calendar size={16} />,
        run: () => void openCalendar(),
      },
      {
        id: "pomodoro",
        label: "Pomodoro Timer",
        section: "GO TO",
        icon: <Timer size={16} />,
        run: openPomodoro,
      },
      {
        id: "spotify",
        label: "Spotify Control",
        section: "GO TO",
        icon: <Music size={16} />,
        run: openSpotify,
      },
      {
        id: "sticky-note",
        label: "New Sticky Note",
        section: "GO TO",
        icon: <StickyNote size={16} />,
        run: () => void openStickyNote(),
      },
      {
        id: "moodboard",
        label: "Moodboard",
        section: "GO TO",
        icon: <LayoutGrid size={16} />,
        run: openMoodboard,
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
        id: "study-deck",
        label: "Study Deck",
        section: "STUDY",
        icon: <BookOpen size={16} />,
        run: () => void openStudyDeckPicker(),
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
      {
        id: "theme",
        label: "Theme Settings",
        section: "CONTROL",
        icon: <Palette size={16} />,
        run: openTheme,
      },
    ];

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return items;
    if (/^(ai|tag|theme):/i.test(query)) return [];
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
    openCalendar,
    openPomodoro,
    openStickyNote,
    openTheme,
    openMoodboard,
    openAddNote,
    openStudyDeckPicker,
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
    if (!supabase) {
      setAuthError(
        "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env",
      );
      return;
    }
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
        selectDeckFromSearch(filteredDecks[activeIndex]);
      } else if (isNoteSearch && filteredNotes[activeIndex]) {
        setActiveNoteIndex(activeIndex);
      } else if (!isDeckSearch && paletteItems[activeIndex]) {
        paletteItems[activeIndex].run();
      }
    }
  };

  const handleSearchKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && isAiMode) {
      const prompt = query.replace(/^ai:\s*/i, "").trim();
      console.log("Enter pressed in AI mode, prompt:", prompt);
      if (prompt) {
        void queryMastraAgent(prompt);
      }
      return;
    }

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

  if (!SUPABASE_CONFIGURED) {
    return (
      <main className="app-shell auth-shell">
        <div className="auth-card">
          <div>
            <p className="eyebrow">Flashcards</p>
            <h1>Configuration required</h1>
          </div>
          <p className="auth-error" style={{ color: "rgba(23, 23, 23, 0.72)" }}>
            Add <strong>VITE_SUPABASE_URL</strong> and{" "}
            <strong>VITE_SUPABASE_ANON_KEY</strong> to your <code>.env</code>{" "}
            file, then restart the app.
          </p>
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
        {mode === "spotify" ? (
          <motion.section
            key="spotify"
            className="panel spotify-hub-panel"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.16 }}
          >
            <SpotifyPanel onClose={() => setMode("palette")} />
          </motion.section>
        ) : mode === "pomodoro" ? (
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
                    style={{
                      transform: "rotate(-90deg)",
                      transformOrigin: "center",
                    }}
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
                    style={{
                      transform: "rotate(-90deg)",
                      transformOrigin: "center",
                    }}
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
                    strokeDashoffset={
                      pomodoroPhase === "work" ? 0 : -(workArcLen + GAP_ARC)
                    }
                    style={{
                      transform: "rotate(-90deg)",
                      transformOrigin: "center",
                    }}
                  />
                </svg>
                <div className="pomodoro-time">
                  <span className="pomodoro-digits">
                    {String(pomodoroMinutes).padStart(2, "0")}:
                    {String(pomodoroSeconds).padStart(2, "0")}
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
        ) : mode === "theme" ? (
          <motion.section
            key="theme"
            className="panel theme-panel"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.16 }}
          >
            <ThemeSettings onClose={() => setMode("palette")} />
          </motion.section>
        ) : mode === "add-note" ? (
          <motion.section
            key="add-note"
            className="panel note-editor-panel"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <Suspense
              fallback={
                <div className="loading-row" style={{ flex: 1 }}>
                  <RefreshCw size={16} className="spin" />
                  <span>Loading editor…</span>
                </div>
              }
            >
              <AddNoteView
                initialNote={editingNote}
                categorySuggestions={noteCategorySuggestions}
                onClose={exitAddNote}
                onSave={saveNote}
              />
            </Suspense>
          </motion.section>
        ) : mode === "moodboard" ? (
          <motion.section
            key="moodboard"
            className="panel moodboard-hub-panel"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.16 }}
          >
            <MoodboardPanel onClose={() => setMode("palette")} />
          </motion.section>
        ) : mode === "study" && studyDeck ? (
          <motion.section
            key="study"
            className="panel study-panel"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <StudyView
              deckName={studyDeck.name}
              cards={studyCards}
              progressByCardId={progressByCardId}
              onSaveProgress={saveCardProgress}
              onExit={exitStudy}
            />
          </motion.section>
        ) : mode === "calendar" ? (
          <motion.section
            key="calendar"
            className="panel calendar-panel"
            initial={{ opacity: 0, x: 18, scale: 0.98 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -18, scale: 0.98 }}
            transition={{ duration: 0.16 }}
          >
            <CalendarView
              events={calendarEvents}
              onClose={() => setMode("palette")}
              onSaveEvent={saveCalendarEvent}
              onDeleteEvent={deleteCalendarEvent}
            />
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
                      <RefreshCw size={28} className="spin" />
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
                  <p className="section-title">
                    {studyPickMode ? "Study — pick a deck" : "Decks"}
                  </p>
                  {filteredDecks.length === 0 ? (
                    <p className="empty-state">No decks found.</p>
                  ) : (
                    filteredDecks.map((deck, index) => {
                      const deckCards = cardsForDeck(cards, deck.id);
                      const dueCount = deck.exclude_from_srs
                        ? 0
                        : deckCards.filter(
                            (card) =>
                              !card.exclude_from_srs &&
                              isCardDue(progressByCardId.get(card.id)),
                          ).length;
                      return (
                        <button
                          key={deck.id}
                          className={index === activeIndex ? "active" : ""}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => selectDeckFromSearch(deck)}
                        >
                          <Library size={16} />
                          <span>{deck.name}</span>
                          <small>
                            {studyPickMode
                              ? `${dueCount} due`
                              : `${deckCards.length} cards`}
                          </small>
                        </button>
                      );
                    })
                  )}
                </>
              ) : isNoteSearch ? (
                <div className="notes-explorer">
                  <aside className="notes-sidebar">
                    <div className="notes-count notes-count-row">
                      <span>{filteredNotes.length} notes</span>
                      <button
                        type="button"
                        className="notes-new-btn"
                        onClick={() => void openAddNote()}
                      >
                        <Plus size={14} />
                        New
                      </button>
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
                        <div className="note-preview-toolbar">
                          <div className="note-kicker">
                            <span>{activeNote.category}</span>
                            <span>{activeNote.project}</span>
                          </div>
                          <button
                            type="button"
                            className="notes-edit-btn"
                            onClick={() => void openAddNote(activeNote)}
                          >
                            <FilePenLine size={14} />
                            Edit
                          </button>
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
