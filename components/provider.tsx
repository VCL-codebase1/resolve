"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, type Badges, type Department, type Me } from "./api";

type Note = { id: string; sentence: string };

type DeskContext = {
  me: Me | null;
  badges: Badges;
  departments: Department[];
  live: number;
  muted: boolean;
  setMuted: (value: boolean) => void;
  composer: boolean;
  setComposer: (value: boolean) => void;
  notes: Note[];
  dismiss: (id: string) => void;
  refresh: () => void;
};

const Ctx = createContext<DeskContext | null>(null);

const emptyBadges: Badges = { inbox: 0, queue: 0, alerts: 0 };

function play(kind: "raise" | "reply" | "status", ctx: AudioContext) {
  const now = ctx.currentTime;
  const tone = (freq: number, at: number, dur: number, type: OscillatorType) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.04, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  };
  if (kind === "raise") tone(880, now, 0.12, "sine");
  if (kind === "reply") {
    tone(660, now, 0.09, "sine");
    tone(520, now + 0.1, 0.11, "sine");
  }
  if (kind === "status") tone(440, now, 0.1, "triangle");
}

export function DeskProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [badges, setBadges] = useState<Badges>(emptyBadges);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [live, setLive] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [composer, setComposer] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const unlocked = useRef(false);
  const lastSound = useRef(0);

  const setMuted = (value: boolean) => {
    setMutedState(value);
    localStorage.setItem("desk-mute", value ? "1" : "0");
  };

  const refresh = useCallback(() => setLive((value) => value + 1), []);

  const dismiss = (id: string) => setNotes((current) => current.filter((note) => note.id !== id));

  useEffect(() => {
    setMutedState(localStorage.getItem("desk-mute") === "1");
    const unlock = () => {
      unlocked.current = true;
      if (!audio.current) audio.current = new AudioContext();
      void audio.current.resume();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<Me>("/me")
      .then(async (person) => {
        if (cancelled) return;
        setMe(person);
        const [badgeBody, departmentBody] = await Promise.all([
          api<Badges>("/badges"),
          api<{ items: Department[] }>("/departments"),
        ]);
        if (cancelled) return;
        setBadges(badgeBody);
        setDepartments(departmentBody.items);
      })
      .catch(() => {
        if (!cancelled) router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    if (!me) return;
    let socket: WebSocket | null = null;
    let ping: number | null = null;
    let retry: number | null = null;
    let wait = 1000;
    let closed = false;

    const connect = () => {
      if (closed) return;
      if (ping) window.clearInterval(ping);
      const protocol = location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${location.host}/ws`);
      socket.onopen = () => {
        wait = 1000;
      };
      socket.onmessage = (event) => {
        const body = JSON.parse(String(event.data)) as {
          type?: string;
          sentence?: string;
          sound?: "raise" | "reply" | "status";
          badges?: Badges;
          notificationId?: string;
        };
        if (body.type === "pong" || body.type === "ready") return;
        if (body.type === "badges.updated" && body.badges) {
          setBadges(body.badges);
          setLive((value) => value + 1);
          return;
        }
        if (body.type === "notification.created" && body.sentence && body.sound) {
          const id = body.notificationId || crypto.randomUUID();
          const sentence = body.sentence;
          setNotes((current) => [{ id, sentence }, ...current].slice(0, 2));
          window.setTimeout(() => setNotes((current) => current.filter((note) => note.id !== id)), 4200);
          setLive((value) => value + 1);
          if (!mutedRef.current && unlocked.current && audio.current && Date.now() - lastSound.current > 80) {
            lastSound.current = Date.now();
            play(body.sound, audio.current);
          }
          return;
        }
        if (body.type?.startsWith("ticket.")) setLive((value) => value + 1);
      };
      socket.onclose = () => {
        if (ping) window.clearInterval(ping);
        if (closed) return;
        retry = window.setTimeout(connect, wait);
        wait = Math.min(wait * 2, 8000);
      };
      ping = window.setInterval(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 25000);
    };
    connect();
    return () => {
      closed = true;
      if (ping) window.clearInterval(ping);
      if (retry) window.clearTimeout(retry);
      socket?.close();
    };
  }, [me]);

  const value = useMemo(
    () => ({ me, badges, departments, live, muted, setMuted, composer, setComposer, notes, dismiss, refresh }),
    [me, badges, departments, live, muted, composer, notes, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDesk() {
  const value = useContext(Ctx);
  if (!value) throw new Error("Desk is not ready.");
  return value;
}
