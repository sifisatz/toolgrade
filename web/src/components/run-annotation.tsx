"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface RunAnnotationProps {
  runId: string;
  initialRating: number | null;
  initialNote: string | null;
}

export function RunAnnotation({
  runId,
  initialRating,
  initialNote,
}: RunAnnotationProps) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [note, setNote] = useState<string>(initialNote ?? "");
  const [savedNote, setSavedNote] = useState<string>(initialNote ?? "");
  const [savingNote, setSavingNote] = useState(false);

  const noteChanged = note !== savedNote;
  const MAX_NOTE = 500;

  async function patchAnnotation(update: {
    rating?: number | null;
    note?: string;
  }) {
    const body: { rating: number | null; note?: string } = {
      rating: update.rating !== undefined ? update.rating : rating,
      ...(update.note !== undefined ? { note: update.note } : {}),
    };
    const res = await fetch(`/api/runs/${runId}/annotation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to save");
  }

  async function handleRatingClick(value: 1 | -1) {
    const prev = rating;
    const next = prev === value ? null : value;
    // Optimistic update
    setRating(next);
    try {
      await patchAnnotation({ rating: next });
    } catch {
      // Revert
      setRating(prev);
      toast.error("Could not save rating. Please try again.");
    }
  }

  async function handleSaveNote() {
    setSavingNote(true);
    const prev = savedNote;
    try {
      await patchAnnotation({ note });
      setSavedNote(note);
      toast.success("Note saved.");
    } catch {
      toast.error("Could not save note. Please try again.");
      setNote(prev);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => handleRatingClick(1)}
          aria-label="Good run"
          aria-pressed={rating === 1}
        >
          <ThumbsUp
            className="size-4"
            style={
              rating === 1
                ? { fill: "var(--primary)", color: "var(--primary)" }
                : { color: "var(--muted-foreground)" }
            }
          />
          <span
            className="text-sm"
            style={
              rating === 1
                ? { color: "var(--primary)" }
                : { color: "var(--muted-foreground)" }
            }
          >
            Good
          </span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => handleRatingClick(-1)}
          aria-label="Bad run"
          aria-pressed={rating === -1}
        >
          <ThumbsDown
            className="size-4"
            style={
              rating === -1
                ? {
                    fill: "var(--destructive)",
                    color: "var(--destructive)",
                  }
                : { color: "var(--muted-foreground)" }
            }
          />
          <span
            className="text-sm"
            style={
              rating === -1
                ? { color: "var(--destructive)" }
                : { color: "var(--muted-foreground)" }
            }
          >
            Bad
          </span>
        </Button>
      </div>

      <div className="space-y-2">
        <Textarea
          placeholder="Add a note about this run…"
          value={note}
          onChange={(e) => setNote(e.target.value.slice(0, MAX_NOTE))}
          className="min-h-20 resize-none"
          maxLength={MAX_NOTE}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {note.length}/{MAX_NOTE}
          </span>
          {noteChanged && (
            <Button size="sm" onClick={handleSaveNote} disabled={savingNote}>
              {savingNote ? "Saving…" : "Save note"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
