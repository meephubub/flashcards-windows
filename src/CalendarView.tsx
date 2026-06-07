import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

export type CalendarEvent = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  starts_at: string;
  ends_at?: string | null;
  all_day: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type CalendarViewProps = {
  events: CalendarEvent[];
  onClose: () => void;
  onSaveEvent: (payload: {
    id?: string;
    title: string;
    description: string;
    starts_at: string;
    ends_at: string | null;
    all_day: boolean;
  }) => Promise<void>;
  onDeleteEvent: (id: string) => Promise<void>;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function eventOnDate(event: CalendarEvent, date: Date) {
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : start;
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
  return start <= dayEnd && end >= dayStart;
}

function formatTimeRange(event: CalendarEvent) {
  if (event.all_day) return "All day";
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : null;
  const time = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (!end) return time;
  const endTime = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${time} – ${endTime}`;
}

function toLocalDatetimeValue(iso: string) {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultStartValue(date: Date, allDay: boolean) {
  if (allDay) {
    return `${toDateKey(date)}T00:00`;
  }
  const next = new Date(date);
  next.setHours(9, 0, 0, 0);
  return toLocalDatetimeValue(next.toISOString());
}

function defaultEndValue(date: Date, allDay: boolean) {
  if (allDay) {
    return `${toDateKey(date)}T23:59`;
  }
  const next = new Date(date);
  next.setHours(10, 0, 0, 0);
  return toLocalDatetimeValue(next.toISOString());
}

export function CalendarView({
  events,
  onClose,
  onSaveEvent,
  onDeleteEvent,
}: CalendarViewProps) {
  const today = useMemo(() => new Date(), []);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(today));
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(() => defaultStartValue(today, false));
  const [endsAt, setEndsAt] = useState(() => defaultEndValue(today, false));
  const [allDay, setAllDay] = useState(false);
  const [saving, setSaving] = useState(false);

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const calendarCells = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const startOffset = first.getDay();
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startOffset);

    return Array.from({ length: 42 }, (_, index) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + index);
      const key = toDateKey(date);
      const dayEvents = events.filter((event) => eventOnDate(event, date));
      return {
        date,
        key,
        inMonth: date.getMonth() === viewMonth.getMonth(),
        isToday: sameDay(date, today),
        isSelected: key === selectedDate,
        events: dayEvents,
      };
    });
  }, [events, selectedDate, today, viewMonth]);

  const selectedDayEvents = useMemo(() => {
    const date = parseDateKey(selectedDate);
    return events
      .filter((event) => eventOnDate(event, date))
      .sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
      );
  }, [events, selectedDate]);

  const openCreate = () => {
    const date = parseDateKey(selectedDate);
    setEditingId(null);
    setTitle("");
    setDescription("");
    setAllDay(false);
    setStartsAt(defaultStartValue(date, false));
    setEndsAt(defaultEndValue(date, false));
    setShowEditor(true);
  };

  const openEdit = (event: CalendarEvent) => {
    setEditingId(event.id);
    setTitle(event.title);
    setDescription(event.description ?? "");
    setAllDay(event.all_day);
    setStartsAt(
      event.all_day
        ? `${toDateKey(new Date(event.starts_at))}T00:00`
        : toLocalDatetimeValue(event.starts_at),
    );
    setEndsAt(
      event.ends_at
        ? event.all_day
          ? `${toDateKey(new Date(event.ends_at))}T23:59`
          : toLocalDatetimeValue(event.ends_at)
        : defaultEndValue(new Date(event.starts_at), event.all_day),
    );
    setShowEditor(true);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const startIso = allDay
        ? new Date(`${startsAt.slice(0, 10)}T00:00:00`).toISOString()
        : new Date(startsAt).toISOString();
      const endIso = endsAt
        ? allDay
          ? new Date(`${endsAt.slice(0, 10)}T23:59:59`).toISOString()
          : new Date(endsAt).toISOString()
        : null;
      await onSaveEvent({
        id: editingId ?? undefined,
        title: title.trim(),
        description: description.trim(),
        starts_at: startIso,
        ends_at: endIso,
        all_day: allDay,
      });
      setShowEditor(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="search-row">
        <Calendar size={17} />
        <button className="deck-pill" onClick={onClose} type="button">
          <span>Calendar</span>
          <X size={12} />
        </button>
        <div style={{ flex: 1 }} />
        <button className="add-task-button" onClick={openCreate} type="button">
          <Plus size={14} />
          New Event
        </button>
      </header>

      <div className="calendar-body">
        <section className="calendar-main">
          <div className="calendar-toolbar">
            <div className="calendar-nav">
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={() => setViewMonth((m) => addMonths(m, -1))}
                aria-label="Previous month"
              >
                <ChevronLeft size={16} />
              </button>
              <h2 className="calendar-month-label">{monthLabel}</h2>
              <button
                type="button"
                className="calendar-nav-btn"
                onClick={() => setViewMonth((m) => addMonths(m, 1))}
                aria-label="Next month"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <button
              type="button"
              className="calendar-today-btn"
              onClick={() => {
                const now = new Date();
                setViewMonth(startOfMonth(now));
                setSelectedDate(toDateKey(now));
              }}
            >
              Today
            </button>
          </div>

          <div className="calendar-weekdays">
            {WEEKDAYS.map((day) => (
              <span key={day} className="calendar-weekday">
                {day}
              </span>
            ))}
          </div>

          <div className="calendar-grid">
            {calendarCells.map((cell) => (
              <button
                key={cell.key}
                type="button"
                className={`calendar-day ${cell.inMonth ? "" : "muted"} ${cell.isToday ? "today" : ""} ${cell.isSelected ? "selected" : ""}`}
                onClick={() => setSelectedDate(cell.key)}
              >
                <span className="calendar-day-num">{cell.date.getDate()}</span>
                {cell.events.length > 0 && (
                  <span className="calendar-day-dots">
                    {cell.events.slice(0, 3).map((ev) => (
                      <span key={ev.id} className="calendar-dot" />
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>

        <aside className="calendar-sidebar">
          <p className="calendar-sidebar-date">
            {parseDateKey(selectedDate).toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          <p className="calendar-sidebar-count">
            {selectedDayEvents.length}{" "}
            {selectedDayEvents.length === 1 ? "event" : "events"}
          </p>
          <div className="calendar-event-list">
            {selectedDayEvents.length === 0 ? (
              <p className="empty-state">No events this day.</p>
            ) : (
              selectedDayEvents.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className="calendar-event-item"
                  onClick={() => openEdit(ev)}
                >
                  <span className="calendar-event-time">
                    {formatTimeRange(ev)}
                  </span>
                  <span className="calendar-event-title">{ev.title}</span>
                  {ev.description && (
                    <span className="calendar-event-desc">{ev.description}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      <footer className="footer-row">
        <div>
          <kbd className="kbd">esc</kbd>
          <span>Hide</span>
        </div>
        <button className="ghost-button" onClick={onClose} type="button">
          <ArrowLeft size={14} />
          Home
        </button>
      </footer>

      <AnimatePresence>
        {showEditor && (
          <motion.div
            className="add-task-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowEditor(false)}
          >
            <motion.form
              className="add-task-modal calendar-event-modal"
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => void handleSubmit(e)}
            >
              <h3>{editingId ? "Edit Event" : "New Event"}</h3>
              <input
                type="text"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
              <textarea
                className="calendar-description-input"
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
              <label className="calendar-all-day">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setAllDay(checked);
                    const date = parseDateKey(selectedDate);
                    setStartsAt(defaultStartValue(date, checked));
                    setEndsAt(defaultEndValue(date, checked));
                  }}
                />
                All day
              </label>
              <input
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? startsAt.slice(0, 10) : startsAt}
                onChange={(e) => {
                  const value = e.target.value;
                  setStartsAt(
                    allDay ? `${value}T00:00` : value,
                  );
                }}
              />
              <input
                type={allDay ? "date" : "datetime-local"}
                value={allDay ? (endsAt ? endsAt.slice(0, 10) : "") : endsAt}
                onChange={(e) => {
                  const value = e.target.value;
                  setEndsAt(allDay ? `${value}T23:59` : value);
                }}
              />
              <div className="modal-actions">
                {editingId && (
                  <button
                    type="button"
                    className="ghost-button calendar-delete-btn"
                    onClick={() => void onDeleteEvent(editingId).then(() => setShowEditor(false))}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                )}
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowEditor(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit" disabled={saving}>
                  {saving ? "Saving…" : editingId ? "Save" : "Add Event"}
                </button>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
