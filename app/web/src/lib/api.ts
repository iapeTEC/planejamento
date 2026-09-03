const TEACHER_TOKEN_KEY = "planejamento:teacherToken";
const COORDINATOR_ID_TOKEN_KEY = "planejamento:coordinatorIdToken";

export function getTeacherToken(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("t");
  if (fromUrl) {
    localStorage.setItem(TEACHER_TOKEN_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TEACHER_TOKEN_KEY) ?? "";
}

export function setCoordinatorIdToken(idToken: string) {
  sessionStorage.setItem(COORDINATOR_ID_TOKEN_KEY, idToken);
}

export function getCoordinatorIdToken(): string {
  return sessionStorage.getItem(COORDINATOR_ID_TOKEN_KEY) ?? "";
}

export function clearCoordinatorIdToken() {
  sessionStorage.removeItem(COORDINATOR_ID_TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  const teacherToken = getTeacherToken();
  const idToken = getCoordinatorIdToken();
  if (idToken) headers.set("authorization", `Bearer ${idToken}`);
  else if (teacherToken) headers.set("x-teacher-token", teacherToken);

  const resp = await fetch(`/api${path}`, { ...init, headers });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(body.error ?? `Erro HTTP ${resp.status}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export interface ClassRef {
  id: string;
  name: string;
  level: "infantil" | "fundamental";
}

export interface Teacher {
  id: string;
  name: string;
  phone: string | null;
  photoUrl: string | null;
  isEnglishTeacher: boolean;
  active: boolean;
  magicToken: string;
  lastSeenAt: string | null;
  classes: { class: ClassRef }[];
}

export interface LessonDay {
  id?: string;
  weekday: string;
  date: string;
  slot: number;
  isRecess?: boolean;
  unitDay?: string;
  conteudo?: string;
  desenvolvimento?: string;
  materiais?: string;
  tarefas?: string;
  pppPresentation?: string;
  pppPractice?: string;
  pppProduction?: string;
  skillListening?: string;
  skillWriting?: string;
  skillReading?: string;
  skillSpeaking?: string;
  agendaHtml?: string;
  agendaGeneratedByAi?: boolean;
}

export interface LessonWeek {
  id: string;
  classId: string;
  term: string;
  weekStart: string;
  coordMessage: string | null;
  days: LessonDay[];
}

export const api = {
  me: () => request<Teacher>("/teachers/me"),

  lessonWeek: (classId: string, weekStart: string) =>
    request<LessonWeek | null>(`/lesson-weeks?classId=${classId}&weekStart=${weekStart}`),

  saveLessonWeek: (payload: {
    classId: string;
    term: string;
    weekStart: string;
    coordMessage?: string;
    days: LessonDay[];
  }) => request<LessonWeek>("/lesson-weeks", { method: "PUT", body: JSON.stringify(payload) }),

  patchLessonDay: (id: string, patch: Partial<LessonDay>) =>
    request<LessonDay>(`/lesson-weeks/days/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  generateAgendaWithAi: (lessonDayId: string) =>
    request<{ jobId: string; text: string }>(`/lesson-days/${lessonDayId}/agenda/generate`, {
      method: "POST",
    }),

  listTeachers: () => request<Teacher[]>("/teachers"),

  heartbeat: () => request<{ ok: true }>("/teachers/heartbeat", { method: "POST" }),

  listClasses: () => request<ClassRef[]>("/classes"),

  createTeacher: (payload: {
    name: string;
    phone?: string;
    photoUrl?: string;
    isEnglishTeacher?: boolean;
    classIds: string[];
  }) => request<Teacher>("/teachers", { method: "POST", body: JSON.stringify(payload) }),

  updateTeacher: (
    id: string,
    payload: Partial<{
      name: string;
      phone: string;
      photoUrl: string;
      isEnglishTeacher: boolean;
      active: boolean;
      classIds: string[];
    }>,
  ) => request<Teacher>(`/teachers/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deleteTeacher: (id: string) => request<void>(`/teachers/${id}`, { method: "DELETE" }),
};
