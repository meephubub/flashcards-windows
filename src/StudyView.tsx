import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, BookOpen } from "lucide-react";
import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Card as FsrsCard, Rating } from "ts-fsrs";
import {
  CardProgressRow,
  fsrsCardToState,
  previewIntervals,
  progressToFsrsCard,
  reviewCard,
  isCardDue,
} from "./lib/fsrs";

export type StudyCard = {
  id: string;
  front: string;
  back: string;
  front_img_url?: string | null;
  back_img_url?: string | null;
};

type StudyViewProps = {
  deckName: string;
  cards: StudyCard[];
  progressByCardId: Map<string, CardProgressRow>;
  onSaveProgress: (
    cardId: string,
    fsrsState: ReturnType<typeof fsrsCardToState>,
    dueDate: string,
  ) => Promise<void>;
  onExit: () => void;
};

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="study-kbd">{children}</kbd>;
}

function MarkdownContent({ children }: { children: string }) {
  return (
    <div className="study-markdown markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

export function StudyView({
  deckName,
  cards,
  progressByCardId,
  onSaveProgress,
  onExit,
}: StudyViewProps) {
  const [phase, setPhase] = useState<"main" | "review" | "done">("main");
  const [reviewQueue, setReviewQueue] = useState<StudyCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [goodFlash, setGoodFlash] = useState(false);

  const [fsrsByCard, setFsrsByCard] = useState(() => {
    const map = new Map<string, FsrsCard>();
    for (const card of cards) {
      map.set(card.id, progressToFsrsCard(progressByCardId.get(card.id)));
    }
    return map;
  });

  const dueCards = useMemo(() => {
    return cards.filter((card) => {
      const prog = progressByCardId.get(card.id);
      return isCardDue(prog);
    });
  }, [cards, progressByCardId]);
  const activeQueue = phase === "review" ? reviewQueue : dueCards;
  const currentCard = activeQueue[index] ?? null;

  const intervals = useMemo(() => {
    if (!currentCard) return { again: "—", good: "—" };
    const fsrsCard = fsrsByCard.get(currentCard.id) ?? progressToFsrsCard(null);
    return previewIntervals(fsrsCard);
  }, [currentCard, fsrsByCard]);

  const finishSession = useCallback(() => {
    setPhase("done");
    setRevealed(false);
  }, []);

  const advanceAfterRating = useCallback(
    (rating: Rating.Again | Rating.Good, mistakes: StudyCard[]) => {
      setRevealed(false);
      const queue = phase === "review" ? mistakes : cards;
      const atEnd = index + 1 >= queue.length;

      if (!atEnd) {
        setIndex((i) => i + 1);
        return;
      }

      if (phase === "main") {
        if (mistakes.length > 0) {
          setPhase("review");
          setIndex(0);
        } else {
          finishSession();
        }
        return;
      }

      if (rating === Rating.Again) {
        setIndex(Math.max(0, mistakes.length - 1));
        return;
      }

      finishSession();
    },
    [cards, finishSession, index, phase],
  );

  const persistRating = useCallback(
    async (rating: Rating.Again | Rating.Good) => {
      if (!currentCard) return;

      const now = new Date();
      const fsrsCard =
        fsrsByCard.get(currentCard.id) ?? progressToFsrsCard(null);
      const result = reviewCard(fsrsCard, rating, now);

      setFsrsByCard((prev) => {
        const next = new Map(prev);
        next.set(currentCard.id, result.card);
        return next;
      });

      await onSaveProgress(
        currentCard.id,
        fsrsCardToState(result.card),
        result.card.due.toISOString(),
      );

      let mistakes = reviewQueue;
      if (rating === Rating.Again) {
        if (phase === "review") {
          mistakes = [
            ...reviewQueue.filter((c) => c.id !== currentCard.id),
            currentCard,
          ];
        } else if (!reviewQueue.some((c) => c.id === currentCard.id)) {
          mistakes = [...reviewQueue, currentCard];
        }
        setReviewQueue(mistakes);
      }

      if (rating === Rating.Good) {
        setGoodFlash(true);
        setTimeout(() => {
          setGoodFlash(false);
          advanceAfterRating(rating, mistakes);
        }, 420);
      } else {
        advanceAfterRating(rating, mistakes);
      }
    },
    [
      advanceAfterRating,
      currentCard,
      fsrsByCard,
      onSaveProgress,
      phase,
      reviewQueue,
    ],
  );

  const reveal = useCallback(() => setRevealed(true), []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (phase === "done") {
        if (event.key === "Escape") onExit();
        return;
      }
      if (!currentCard) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onExit();
        return;
      }

      if (!revealed) {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          reveal();
        }
        return;
      }

      if (event.key === "1") {
        event.preventDefault();
        void persistRating(Rating.Again);
      } else if (event.key === " ") {
        event.preventDefault();
        void persistRating(Rating.Good);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentCard, onExit, persistRating, phase, reveal, revealed]);

  const handleStudyKey = (event: ReactKeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
    }
  };

  const progressLabel =
    phase === "review"
      ? `${reviewQueue.length - index} left`
      : `${dueCards.length - index} left`;

  // If there are no due cards, show empty state
  if (dueCards.length === 0) {
    return (
      <div className="study-view" onKeyDown={handleStudyKey}>
        <div className="study-empty">
          <BookOpen size={32} strokeWidth={1.5} />
          <p>No cards due in this deck.</p>
          <button type="button" className="study-show-btn" onClick={onExit}>
            Back
          </button>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="study-view study-view--done" onKeyDown={handleStudyKey}>
        <div className="study-done">
          <p className="study-done-title">Session complete</p>
          <p className="study-done-sub">{deckName}</p>
          <button type="button" className="study-show-btn" onClick={onExit}>
            Done
          </button>
        </div>
        <footer className="study-footer">
          <Kbd>esc</Kbd>
          <span>Close</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="study-view" onKeyDown={handleStudyKey}>
      <header className="study-header">
        <span className="study-deck-name">{deckName}</span>
        {phase === "review" && (
          <span className="study-phase-badge">Review</span>
        )}
        <span className="study-progress">{progressLabel}</span>
      </header>

      <div className={`study-stage${goodFlash ? " study-stage--good" : ""}`}>
        {goodFlash && <div className="study-good-ripple" />}
        <AnimatePresence mode="wait">
          {!revealed ? (
            <motion.div
              key={`front-${currentCard?.id}-${index}`}
              className="study-card study-card--front"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              {currentCard && (
                <>
                  <MarkdownContent>{currentCard.front}</MarkdownContent>
                  {currentCard.front_img_url && (
                    <img
                      className="study-img"
                      src={currentCard.front_img_url}
                      alt=""
                    />
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key={`back-${currentCard?.id}-${index}`}
              className="study-card study-card--revealed"
              initial={{ opacity: 0, y: 12 }}
              animate={
                goodFlash
                  ? { opacity: 1, y: 0, scale: [1, 1.018, 1] }
                  : { opacity: 1, y: 0 }
              }
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              {currentCard && (
                <>
                  <div className="study-front-recap">
                    <MarkdownContent>{currentCard.front}</MarkdownContent>
                  </div>
                  <hr className="study-divider" />
                  <div className="study-back-content">
                    <MarkdownContent>{currentCard.back}</MarkdownContent>
                    {currentCard.back_img_url && (
                      <img
                        className="study-img"
                        src={currentCard.back_img_url}
                        alt=""
                      />
                    )}
                  </div>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="study-controls">
        <AnimatePresence mode="wait" initial={false}>
          {!revealed ? (
            <motion.div
              key="show-controls"
              className="study-controls-inner"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92, y: 4 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            >
              <Kbd>space</Kbd>
              <button type="button" className="study-show-btn" onClick={reveal}>
                Show
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="grade-controls"
              className="study-grade-row"
              initial={{ opacity: 0, scale: 0.92, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <motion.div
                className="study-grade-col"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: 0.06,
                  duration: 0.22,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <Kbd>1</Kbd>
                <button
                  type="button"
                  className="study-grade-btn study-grade-btn--again"
                  onClick={() => void persistRating(Rating.Again)}
                >
                  Again
                  <span className="study-interval">{intervals.again}</span>
                </button>
              </motion.div>
              <motion.div
                className="study-grade-col"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{
                  delay: 0.1,
                  duration: 0.22,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <Kbd>space</Kbd>
                <button
                  type="button"
                  className={`study-grade-btn study-grade-btn--good${goodFlash ? " study-grade-btn--flash" : ""}`}
                  onClick={() => void persistRating(Rating.Good)}
                >
                  Good
                  <span className="study-interval">{intervals.good}</span>
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <footer className="study-footer">
        <button type="button" className="study-back-link" onClick={onExit}>
          <ArrowLeft size={14} />
          Exit
        </button>
        <div>
          <Kbd>esc</Kbd>
          <span>Exit</span>
        </div>
      </footer>
    </div>
  );
}
