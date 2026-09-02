import { useCallback, useEffect, useRef, useState } from "react";
import { api, type LessonDay } from "./api";

export interface WeekDraft {
  classId: string;
  term: string;
  weekStart: string;
  coordMessage: string;
  days: LessonDay[];
}

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

function draftKey(classId: string, weekStart: string): string {
  return `planejamento:draft:${classId}:${weekStart}`;
}

/**
 * Autosave: grava rascunho no localStorage a cada mudança (sobrevive a queda
 * de luz/internet), envia pro servidor com debounce, e permite flush()
 * imediato no blur ou no botão "Salvar". Nunca perde o que foi digitado.
 */
export function useAutosave(draft: WeekDraft) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  // Persiste no localStorage a cada render com mudança — imediato, sem debounce.
  useEffect(() => {
    localStorage.setItem(draftKey(draft.classId, draft.weekStart), JSON.stringify(draft));
  }, [draft]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setStatus("saving");
    try {
      await api.saveLessonWeek(latestDraft.current);
      localStorage.removeItem(draftKey(latestDraft.current.classId, latestDraft.current.weekStart));
      setStatus("saved");
    } catch {
      // Rascunho continua no localStorage — nada se perde, só não sincronizou ainda.
      setStatus("error");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    setStatus("dirty");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, 1500);
  }, [flush]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { status, scheduleSave, flush };
}

/** Recupera um rascunho não sincronizado salvo localmente, se existir. */
export function loadDraft(classId: string, weekStart: string): WeekDraft | null {
  const raw = localStorage.getItem(draftKey(classId, weekStart));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WeekDraft;
  } catch {
    return null;
  }
}
