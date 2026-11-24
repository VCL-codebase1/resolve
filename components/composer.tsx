"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Me } from "./api";
import { Logo, ThemeToggle } from "./brand";
import { useDesk } from "./provider";

export function Composer() {
  const { composer, setComposer, departments, refresh } = useDesk();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  if (!composer) return null;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const ticket = await api<{ id: string; messages: { id: string }[] }>("/tickets", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          body: form.get("body"),
          targetDepartment: form.get("targetDepartment"),
          priority: form.get("priority"),
        }),
      });
      const file = form.get("file");
      if (file instanceof File && file.size > 0 && ticket.messages[0]) {
        const upload = new FormData();
        upload.set("file", file);
        upload.set("messageId", ticket.messages[0].id);
        await api(`/tickets/${ticket.id}/attachments`, { method: "POST", body: upload });
      }
      setComposer(false);
      refresh();
      router.push(`/tickets/${ticket.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That ticket did not send.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(8,22,52,0.28)] min-[760px]:items-center" onClick={() => setComposer(false)}>
      <form
        onClick={(event) => event.stopPropagation()}
        onSubmit={onSubmit}
        className="glass max-h-[92dvh] w-full overflow-auto rounded-t-[28px] min-[760px]:max-w-lg min-[760px]:rounded-[28px]"
      >
        <div className="flex h-14 items-center justify-between px-5">
          <h2 className="text-[16px] font-semibold">New ticket</h2>
          <button type="button" className="h-11 text-[14px] text-action" onClick={() => setComposer(false)}>
            Cancel
          </button>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5">
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Title
            <input name="title" required maxLength={120} className="h-11 rounded-[10px] border border-line bg-white px-3 font-normal outline-none" />
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Department
            <select name="targetDepartment" required className="h-11 rounded-[10px] border border-line bg-white px-3 font-normal" defaultValue="">
              <option value="" disabled>
                Choose
              </option>
              {departments.map((department) => (
                <option key={department.slug} value={department.slug}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Priority
            <select name="priority" className="h-11 rounded-[10px] border border-line bg-white px-3 font-normal" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Note
            <textarea name="body" required maxLength={8000} rows={5} className="rounded-[10px] border border-line bg-white px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            File
            <input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="text-[14px] font-normal" />
          </label>
          {error ? <p className="text-[14px] text-danger">{error}</p> : null}
          <button type="submit" disabled={pending} className="h-11 rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
            {pending ? "Raising…" : "Raise ticket"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function LoginForm({ admin = false }: { admin?: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const person = await api<Me>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      const wrongDoor = admin ? person.role !== "admin" : person.role === "admin";
      if (wrongDoor) {
        await api("/auth/logout", { method: "POST" });
        setError(admin ? "This page is for admins. Staff use the main sign-in." : "Admins sign in at the admin page.");
        return;
      }
      router.replace(admin ? "/monitor" : "/inbox");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Email or password is wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="stage flex min-h-dvh items-center justify-center px-5">
      <form onSubmit={onSubmit} className="pane w-full max-w-sm rounded-[28px] px-6 py-7">
        <div className="flex items-center justify-between">
          <Link href="/">
            <Logo className="h-12 w-auto" />
          </Link>
          <ThemeToggle />
        </div>
        <Link href="/" className="mt-4 inline-flex h-11 items-center text-[14px] text-action">
          Back to home
        </Link>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight">{admin ? "Admin sign in" : "Sign in"}</h1>
        <p className="mt-2 text-[16px] leading-6 text-ink-soft">
          {admin ? "Monitor, directory, and passwords." : "Use the work email an admin gave you."}
        </p>
        <label className="mt-8 flex flex-col gap-1 text-[14px] font-medium">
          Email
          <input name="email" type="email" autoComplete="username" required className="h-11 rounded-[10px] border border-line bg-white px-3 font-normal" />
        </label>
        <label className="mt-4 flex flex-col gap-1 text-[14px] font-medium">
          Password
          <input name="password" type="password" autoComplete="current-password" required className="h-11 rounded-[10px] border border-line bg-white px-3 font-normal" />
        </label>
        {error ? <p className="mt-4 text-[14px] text-danger">{error}</p> : null}
        <button type="submit" disabled={pending} className="mt-6 h-11 w-full rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
