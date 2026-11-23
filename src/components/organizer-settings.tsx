"use client";

import { useState } from "react";
import { Plus, Ticket, Trash2 } from "lucide-react";
import type { Organizer, Tag } from "@/lib/types";
import { blocked, OFFLINE } from "@/lib/reject";
import { slugId } from "@/lib/settings";
import { SubPage, useCommit, type SettingsProps } from "./settings";
import { buzz, EmptyState } from "./ui";
import { AddMenu } from "./add-menu";
import { BulkNamesSheet } from "./bulk-add";
import {
  matches,
  andText,
  namesText,
  plural,
  RecordGroup,
  RecordNoMatch,
  RecordRow,
  RecordSearch,
  RecordSelectBar,
  RecordSelectToggle,
  RecordSheet,
  useRecordSave,
  useRecordSelect,
} from "./records";

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
      saveBlocked={!name.trim() ? "Enter an organizer name." : events.some((e) => !e.name.trim()) && "Enter a name for each event."}
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
              {...blocked(!adding.trim() && "Enter an event name.")}
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
  const [addingBulk, setAddingBulk] = useState(false);
  const [query, setQuery] = useState("");
  const shown = list.filter((o) => matches(query, o.name, ...o.events.map((e) => e.name)));
  const events = list.reduce((n, o) => n + o.events.length, 0);
  const taken = list.flatMap((o) => [o.id, ...o.events.map((e) => e.id)]);
  const save = (next: Organizer[], label: string) =>
    commit.run((pin) => props.onAction({ action: "organizers", organizers: next, pin }), label);
  const select = useRecordSelect(list.map((o) => o.id));
  const canEdit = props.online || Boolean(props.demo);
  const addOrganizer = !select.on && (
    <AddMenu
      singleLabel="Add an organizer"
      blockedReason={!canEdit ? OFFLINE : list.length >= 200 && "The list can hold up to 200 organizers."}
      onSingle={() => setEditing("new")}
      onBulk={() => setAddingBulk(true)}
    />
  );
  return (
    <SubPage
      title="Organizers"
      action={list.length < 2 ? undefined : <RecordSelectToggle select={select} disabled={!canEdit} />}
      help={<p>The bazaars and markets you join, and their events. You pick them when you schedule a shift, and the leaderboard ranks them. Add or remove them here.</p>}
      sentence={list.length > 0 && (
        <>
          {plural(list.length, "organizer")} <span className="g">running {plural(events, "event")}.</span>
        </>
      )}
      sentenceAction={list.length > 0 && addOrganizer}
      onBack={props.onBack}
      backLabel={props.backLabel}
    >
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
              select={select.row(o.id)}
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
        <EmptyState
          pose="welcome"
          object="marketStall"
          title="No organizers yet"
          text="Add them here, or type a new one while scheduling a shift."
        >
          {addOrganizer}
        </EmptyState>
      )}
      {select.on && (
        <RecordSelectBar
          select={select}
          shown={shown.map((o) => o.id)}
          noun="organizer"
          removeDetail={(ids) => {
            const shifts = bookings.filter((b) => b.organizer && ids.includes(b.organizer.id)).length;
            const names = andText(list.filter((o) => ids.includes(o.id)).map((o) => o.name), 3);
            return shifts
              ? `${names} and their events will be removed. ${shifts === 1 ? "1 scheduled shift keeps the name it was" : shifts + " scheduled shifts keep the names they were"} saved with.`
              : `${names} and their events will be removed.`;
          }}
          onRemove={(ids) => save(list.filter((o) => !ids.includes(o.id)), "Removed " + plural(ids.length, "organizer"))}
        />
      )}
      {addingBulk && (
        <BulkNamesSheet
          noun="organizer"
          label="Organizer names, one per line"
          maxLength={80}
          limit={200 - list.length}
          onClose={() => setAddingBulk(false)}
          onSave={(names) => {
            const used = [...taken];
            const byName = new Set(list.map((organizer) => organizer.name.trim().toLocaleLowerCase()));
            const added = names.map((name) => {
              const key = name.toLocaleLowerCase();
              if (byName.has(key)) throw Error(`“${name}” is already in the organizer list.`);
              byName.add(key);
              const id = slugId(name, used);
              used.push(id);
              return { id, name, events: [] };
            });
            return save([...list, ...added], "Added " + plural(added.length, "organizer"));
          }}
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
