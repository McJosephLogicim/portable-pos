"use client";

import { useState } from "react";
import { Plus, Ticket, Trash2 } from "lucide-react";
import type { Organizer, Tag } from "@/lib/types";
import { slugId } from "@/lib/settings";
import { SubPage, useCommit, type SettingsProps } from "./settings";
import { buzz } from "./ui";
import { matches, namesText, plural, RecordAdd, RecordEmpty, RecordGroup, RecordNoMatch, RecordRow, RecordSearch, RecordSheet, useRecordSave } from "./records";

/** An organizer, like a mall or a market group, and the events they run. */
function OrganizerSheet({
  organizer,
  taken,
  shifts,
  onSave,
  onRemove,
  onClose,
}: {
  organizer?: Organizer;
  /** Ids already used by organizers and events, so new ones don't clash. */
  taken: string[];
  /** Scheduled shifts at this organizer. */
  shifts: number;
  onSave: (o: Organizer) => Promise<boolean>;
  onRemove?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(organizer?.name ?? "");
  const [events, setEvents] = useState<Tag[]>(organizer?.events ?? []);
  const [adding, setAdding] = useState("");
  const { busy, error, run } = useRecordSave(onClose);
  const ids = () => [...taken, ...events.map((e) => e.id)];
  function addEvent() {
    const text = adding.trim();
    if (!text || events.some((e) => e.name.toLocaleLowerCase() === text.toLocaleLowerCase())) return;
    setEvents([...events, { id: slugId(text, ids()), name: text.slice(0, 80) }]);
    setAdding("");
    buzz.tick();
  }
  return (
    <RecordSheet
      noun="organizer"
      editing={Boolean(organizer)}
      busy={busy}
      error={error}
      canSave={Boolean(name.trim()) && events.every((e) => e.name.trim())}
      onSave={() =>
        void run(() => {
          const text = adding.trim();
          const all = text ? [...events, { id: slugId(text, ids()), name: text }] : events;
          return onSave({
            id: organizer?.id ?? slugId(name, taken),
            name: name.trim(),
            events: all.map((e) => ({ ...e, name: e.name.trim() })),
          });
        })
      }
      onRemove={onRemove}
      onClose={onClose}
    >
      <div className="card card-pad">
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            maxLength={80}
            autoFocus={!organizer}
            placeholder="e.g. Weekend Market Co."
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>
      <div className="stack gap-10">
        <p className="group-title">Events</p>
        <div className="card card-list">
          {events.map((e) => (
            <div className="list-row edit-row" key={e.id}>
              <input
                className="inline-input grow"
                aria-label="Event name"
                maxLength={80}
                value={e.name}
                onChange={(x) => {
                  const text = x.currentTarget.value;
                  setEvents((all) => all.map((y) => (y.id === e.id ? { ...y, name: text } : y)));
                }}
              />
              <button
                type="button"
                className="round flat"
                aria-label={"Remove " + e.name}
                onClick={() => setEvents((all) => all.filter((y) => y.id !== e.id))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <div className="list-row edit-row">
            <input
              className="inline-input grow"
              aria-label="New event"
              maxLength={80}
              placeholder={events.length ? "Another event" : "e.g. Christmas Bazaar"}
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                addEvent();
              }}
            />
            <button
              type="button"
              className="round flat"
              aria-label="Add event"
              disabled={!adding.trim()}
              onClick={addEvent}
            >
              <Plus size={18} />
            </button>
          </div>
        </div>
      </div>
      <p className="label">
        {organizer && shifts
          ? `${plural(shifts, "scheduled shift")} at ${organizer.name} keep the names they were saved with.`
          : "Pick the organizer and event when you schedule a shift."}
      </p>
    </RecordSheet>
  );
}

export function OrganizersPage(props: SettingsProps) {
  const list = props.state.organizers ?? [];
  const bookings = props.state.bookings ?? [];
  const commit = useCommit(props);
  const [editing, setEditing] = useState<Organizer | "new" | null>(null);
  const [query, setQuery] = useState("");
  const shown = list.filter((o) => matches(query, o.name, ...o.events.map((e) => e.name)));
  const events = list.reduce((n, o) => n + o.events.length, 0);
  const taken = list.flatMap((o) => [o.id, ...o.events.map((e) => e.id)]);
  const save = (next: Organizer[], label: string) =>
    commit.run((pin) => props.onAction({ action: "organizers", organizers: next, pin }), label);
  return (
    <SubPage
      title="Organizers"
      help={<p>The bazaars and markets you join, and their events. You pick them when you schedule a shift, and the leaderboard ranks them. Add or remove them here.</p>}
      sentence={
        list.length ? (
          <>
            {plural(list.length, "organizer")} <span className="g">running {plural(events, "event")}.</span>
          </>
        ) : (
          <>
            No organizers. <span className="g">Add the markets and bazaars you join.</span>
          </>
        )
      }
      onBack={() => props.onPage(null)}
    >
      <RecordAdd label="Add organizer" disabled={!props.online && !props.demo} onClick={() => setEditing("new")} />
      <RecordSearch count={list.length} noun="organizers and events" query={query} onQuery={setQuery} />
      {list.length > 0 && !shown.length ? (
        <RecordNoMatch query={query} onClear={() => setQuery("")} />
      ) : list.length > 0 ? (
        <RecordGroup>
          {shown.map((o) => (
            <RecordRow
              key={o.id}
              disabled={!props.online && !props.demo}
              onClick={() => setEditing(o)}
              lead={
                <span className="well">
                  <Ticket size={18} strokeWidth={1.8} />
                </span>
              }
              title={o.name}
              detail={o.events.length ? namesText(o.events.map((e) => e.name)) : "No events yet"}
              end={plural(o.events.length, "event")}
            />
          ))}
        </RecordGroup>
      ) : (
        <RecordEmpty
          icon={<Ticket size={22} strokeWidth={1.6} />}
          title="No organizers yet"
          text="Add them here, or type a new one while scheduling a shift."
        />
      )}
      {editing && (
        <OrganizerSheet
          organizer={editing === "new" ? undefined : editing}
          taken={editing === "new" ? taken : taken.filter((id) => id !== editing.id && !editing.events.some((e) => e.id === id))}
          shifts={editing === "new" ? 0 : bookings.filter((b) => b.organizer?.id === editing.id).length}
          onClose={() => setEditing(null)}
          onSave={(o) =>
            save(
              list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [...list, o],
              (editing === "new" ? "Added " : "Saved ") + o.name,
            )
          }
          onRemove={
            editing === "new" ? undefined : () => save(list.filter((x) => x.id !== editing.id), "Removed " + editing.name)
          }
        />
      )}
    </SubPage>
  );
}
