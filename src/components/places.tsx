"use client";

import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { distanceKm } from "@/lib/team";
import type { Place } from "@/lib/types";
import { Sheet } from "./ui";

/* Search and map tiles come from OpenStreetMap services that need no API key. */
const SEARCH = "https://photon.komoot.io/api/";
const TILE = (z: number, x: number, y: number) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

type Point = { lat: number; lon: number };

/** Where to center searches before the phone shares its location. */
const zoneCenters: Record<string, Point> = {
  "Asia/Manila": { lat: 14.5995, lon: 120.9842 },
  "Asia/Singapore": { lat: 1.3521, lon: 103.8198 },
  "Asia/Jakarta": { lat: -6.2088, lon: 106.8456 },
  "Asia/Kuala_Lumpur": { lat: 3.139, lon: 101.6869 },
  "Asia/Bangkok": { lat: 13.7563, lon: 100.5018 },
  "Asia/Ho_Chi_Minh": { lat: 10.8231, lon: 106.6297 },
};

interface Feature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

function toPlace(f: Feature): Place | null {
  const p = f.properties;
  const [lon, lat] = f.geometry.coordinates;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const name = p.name || street || p.city;
  if (!name) return null;
  const address = [street !== name ? street : "", p.district, p.city !== name ? p.city : "", p.city ? "" : p.state]
    .filter(Boolean)
    .join(", ");
  return { name, address: address || p.country, lat, lon };
}

export function distanceText(km: number) {
  if (km < 0.1) return "<0.1 km";
  if (km < 10) return km.toFixed(1) + " km";
  return Math.round(km) + " km";
}

const tileX = (lon: number, n: number) => ((lon + 180) / 360) * n;
const tileY = (lat: number, n: number) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
};
const toPoint = (fx: number, fy: number, n: number): Point => ({
  lon: Math.round((((((fx / n) * 360) % 360) + 360) % 360 - 180) * 1e6) / 1e6,
  lat: Math.round(((Math.atan(Math.sinh(Math.PI * (1 - (2 * fy) / n))) * 180) / Math.PI) * 1e6) / 1e6,
});

/**
 * A small map centered on a point, drawn from standard tiles so it needs no SDK or key.
 * With onMove, the pin stays in the middle: drag the map under it, or tap a spot to put the
 * pin there.
 */
export function MapPreview({
  lat,
  lon,
  height = 180,
  zoom = 16,
  onMove,
}: Point & { height?: number; zoom?: number; onMove?: (point: Point) => void }) {
  const n = 2 ** zoom;
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fx = tileX(lon, n) - (drag?.x ?? 0) / 256;
  const fy = tileY(lat, n) - (drag?.y ?? 0) / 256;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  const tiles: { x: number; y: number; left: number; top: number }[] = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -1; dy <= 1; dy++)
      tiles.push({
        x: (((tx + dx) % n) + n) % n,
        y: ty + dy,
        left: (tx + dx - fx) * 256,
        top: (ty + dy - fy) * 256,
      });
  const finish = (x: number, y: number) => {
    const s = start.current;
    start.current = null;
    if (!s || !onMove) return;
    const moved = Math.hypot(x - s.x, y - s.y);
    setDrag(null);
    if (moved > 6) {
      onMove(toPoint(tileX(lon, n) - (x - s.x) / 256, tileY(lat, n) - (y - s.y) / 256, n));
    } else {
      // A tap: put the pin where the finger landed.
      const box = ref.current!.getBoundingClientRect();
      onMove(toPoint(tileX(lon, n) + (x - box.left - box.width / 2) / 256, tileY(lat, n) + (y - box.top - box.height / 2) / 256, n));
    }
  };
  return (
    <div
      ref={ref}
      className={"map" + (onMove ? " movable" : "")}
      style={{ height }}
      role="img"
      aria-label={onMove ? "Map. Drag it or tap a spot to move the pin." : "Map of the location"}
      onPointerDown={onMove ? (e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        e.currentTarget.setPointerCapture(e.pointerId);
      } : undefined}
      onPointerMove={onMove ? (e) => {
        const s = start.current;
        if (!s || s.id !== e.pointerId) return;
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6) setDrag({ x: e.clientX - s.x, y: e.clientY - s.y });
      } : undefined}
      onPointerUp={onMove ? (e) => finish(e.clientX, e.clientY) : undefined}
      onPointerCancel={onMove ? () => {
        start.current = null;
        setDrag(null);
      } : undefined}
    >
      <div className="map-tiles">
        {tiles
          .filter((t) => t.y >= 0 && t.y < n)
          .map((t) => (
            <img
              key={t.x + ":" + t.y}
              src={TILE(zoom, t.x, t.y)}
              alt=""
              width={256}
              height={256}
              draggable={false}
              loading="lazy"
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
              style={{ transform: `translate(${t.left}px, ${t.top}px)` }}
            />
          ))}
      </div>
      <span className={"map-pin" + (drag ? " lifted" : "")} aria-hidden="true">
        <MapPin size={20} strokeWidth={2.2} />
      </span>
      <a
        className="map-credit"
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap
      </a>
    </div>
  );
}

export function mapsLink(place: Place) {
  return place.lat !== undefined && place.lon !== undefined
    ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lon}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        [place.name, place.address].filter(Boolean).join(", "),
      )}`;
}

/** Search like a phone's location tag: a list with distances, then a map to confirm. */
export function LocationPicker({
  recent,
  timeZone,
  onPick,
  onClose,
}: {
  recent: Place[];
  timeZone: string;
  onPick: (place: Place) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [here, setHere] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [preview, setPreview] = useState<Place | null>(null);
  const [picked, setPicked] = useState<Place | null>(null);
  const moved = Boolean(preview && picked && (preview.lat !== picked.lat || preview.lon !== picked.lon));
  const seq = useRef(0);
  const locationRequest = useRef(0);
  const center = here ?? zoneCenters[timeZone];

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    const id = ++seq.current;
    setStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const url = new URL(SEARCH);
        url.searchParams.set("q", q);
        url.searchParams.set("limit", "10");
        url.searchParams.set("lang", "en");
        if (center) {
          url.searchParams.set("lat", String(center.lat));
          url.searchParams.set("lon", String(center.lon));
        }
        const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw Error();
        const data = (await response.json()) as { features: Feature[] };
        if (id !== seq.current) return;
        const seen = new Set<string>();
        setResults(
          data.features
            .map(toPlace)
            .filter((p): p is Place => {
              if (!p) return false;
              const key = p.name + "|" + p.address;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            }),
        );
        setStatus("idle");
      } catch {
        if (id === seq.current) setStatus("error");
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, center?.lat, center?.lon]);

  function showPreview(place: Place) {
    locationRequest.current += 1;
    setLocating(false);
    setLocateError("");
    setPicked(place);
    setPreview(place);
  }

  function locate() {
    setLocateError("");
    if (!navigator.geolocation) {
      setLocateError("This phone can't share its location here.");
      return;
    }
    const request = ++locationRequest.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (request !== locationRequest.current) return;
        const point = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setHere(point);
        showPreview({ name: "My location", ...point });
      },
      (e) => {
        if (request !== locationRequest.current) return;
        setLocating(false);
        setLocateError(e.code === e.PERMISSION_DENIED
          ? "Location is blocked. Allow it for this site in your browser settings, then try again."
          : "Couldn't find you. Try again outside or with a connection.");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  }

  const typed = query.trim();
  const list = typed.length >= 2 ? results : recent;
  const away = (p: Place) =>
    here && p.lat !== undefined && p.lon !== undefined
      ? distanceText(distanceKm(here, { lat: p.lat, lon: p.lon }))
      : "";

  return (
    <>
      <Sheet
        title="Location"
        onClose={onClose}
      >
        <div className="search-field">
          <Search size={18} aria-hidden="true" />
          <input
            className="input"
            type="search"
            autoFocus
            enterKeyHint="search"
            aria-label="Search places"
            placeholder="Mall, park or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="location-action">
          <button type="button" className="chip-button" disabled={locating} onClick={locate}>
            <LocateFixed size={15} strokeWidth={2} aria-hidden="true" />
            {locating ? "Finding you…" : "My location"}
          </button>
          {locateError && <p className="label" role="alert">{locateError}</p>}
        </div>
        <div className="place-list" role="listbox" aria-label="Places">
          {typed.length < 2 && recent.length > 0 && <p className="group-title">Used before</p>}
          {list.map((p, i) => {
            const distance = away(p);
            return (
              <button
                key={p.name + (p.address ?? "") + i}
                type="button"
                role="option"
                aria-selected={false}
                className="place-row"
                onClick={() => {
                  if (p.lat === undefined) return onPick(p);
                  showPreview(p);
                }}
              >
                <span className="ellipsis strong-ish">{p.name}</span>
                <span className="label ellipsis">
                  {[distance, p.address].filter(Boolean).join(" · ") || "No map pin"}
                </span>
              </button>
            );
          })}
          {status === "loading" && !results.length && <p className="label pad-y">Searching…</p>}
          {status === "error" && (
            <p className="label pad-y">Search needs a connection. You can still use the name you typed.</p>
          )}
          {status === "idle" && typed.length >= 2 && !results.length && (
            <p className="label pad-y">No places found.</p>
          )}
          {typed.length === 0 && !recent.length && (
            <p className="label pad-y">
              Type the venue, like a mall, park or street.
            </p>
          )}
          {typed.length >= 2 && (
            <button type="button" className="place-row" onClick={() => onPick({ name: typed.slice(0, 160) })}>
              <span className="ellipsis">Use “{typed}”</span>
              <span className="label">Without a map pin</span>
            </button>
          )}
        </div>
      </Sheet>
      {preview && preview.lat !== undefined && preview.lon !== undefined && (
        <Sheet
          title="Map preview"
          onClose={() => setPreview(null)}
          footer={
            <button className="btn block" onClick={() => onPick(preview)}>
              Use this location
            </button>
          }
        >
          <div className="stack gap-4" style={{ textAlign: "center" }}>
            <p className="label">The shift will show up here</p>
            <p className="strong">{preview.name}</p>
            {preview.address && <p className="label">{preview.address}</p>}
          </div>
          <MapPreview
            lat={preview.lat}
            lon={preview.lon}
            height={280}
            onMove={(point) => setPreview({ ...preview, ...point })}
          />
          <p className="label" style={{ textAlign: "center" }}>
            {moved ? "Pin moved. Drag again or tap to fine-tune." : "Not quite right? Drag the map or tap the exact spot."}
          </p>
        </Sheet>
      )}
    </>
  );
}
