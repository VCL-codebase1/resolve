export type ToastNote = { id: string; sentence: string; tone: "success" | "error" | "live" };

const edge = {
  success: "border-l-action",
  error: "border-l-danger text-danger",
  live: "border-l-ink",
};

export function ToastList({ notes, dismiss, dock = true }: { notes: ToastNote[]; dismiss: (id: string) => void; dock?: boolean }) {
  if (notes.length === 0) return null;
  return (
    <div
      className={`pointer-events-none fixed inset-x-2 top-[calc(4.5rem+env(safe-area-inset-top))] z-50 flex flex-col items-center gap-2 min-[480px]:inset-x-3 min-[480px]:top-20 ${dock ? "min-[880px]:left-[280px]" : ""}`}
      aria-live="polite"
    >
      {notes.slice(0, 3).map((note) => (
        <button
          key={note.id}
          type="button"
          className={`glass slide-in pointer-events-auto w-full max-w-lg rounded-[18px] border-l-4 px-4 py-3 text-left text-[14px] ${edge[note.tone]}`}
          onClick={() => dismiss(note.id)}
        >
          {note.sentence}
        </button>
      ))}
    </div>
  );
}
