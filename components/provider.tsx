"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Badges, type Department, type Me } from "./api";
import { chime, unlockSound } from "./sound";

export type ToastTone = "success" | "error" | "live";
type Note = { id: string; sentence: string; tone: ToastTone };

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
  toast: (sentence: string, tone?: "success" | "error") => void;
  refresh: () => void;
};

const Ctx = createContext<DeskContext | null>(null);

const emptyBadges: Badges = { inbox: 0, queue: 0, alerts: 0 };

export function DeskProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [badges, setBadges] = useState<Badges>(emptyBadges);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [live, setLive] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [composer, setComposer] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const setMuted = (value: boolean) => {
    setMutedState(value);
    localStorage.setItem("desk-mute", value ? "1" : "0");
  };

  const refresh = useCallback(() => setLive((value) => value + 1), []);

  const dismiss = (id: string) => setNotes((current) => current.filter((note) => note.id !== id));

  const sound = useCallback((kind: "success" | "error" | "raise" | "reply" | "status") => {
    if (mutedRef.current) return;
    chime(kind);
  }, []);

  const pushNote = useCallback((sentence: string, tone: ToastTone) => {
    const id = crypto.randomUUID();
    setNotes((current) => [{ id, sentence, tone }, ...current].slice(0, 3));
    window.setTimeout(() => setNotes((current) => current.filter((note) => note.id !== id)), 4200);
    return id;
  }, []);

  const toast = useCallback(
    (sentence: string, tone: "success" | "error" = "success") => {
      pushNote(sentence, tone);
      sound(tone);
    },
    [pushNote, sound],
  );

  useEffect(() => {
    setMutedState(localStorage.getItem("desk-mute") === "1");
    window.addEventListener("pointerdown", unlockSound);
    window.addEventListener("keydown", unlockSound);
    return () => {
      window.removeEventListener("pointerdown", unlockSound);
      window.removeEventListener("keydown", unlockSound);
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
  }, [router]);

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
          pushNote(body.sentence, "live");
          setLive((value) => value + 1);
          sound(body.sound);
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
  }, [me, pushNote, sound]);

  const value = useMemo(
    () => ({ me, badges, departments, live, muted, setMuted, composer, setComposer, notes, dismiss, toast, refresh }),
    [me, badges, departments, live, muted, composer, notes, toast, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDesk() {
  const value = useContext(Ctx);
  if (!value) throw new Error("Desk is not ready.");
  return value;
}
