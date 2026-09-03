const TEACHER_TOKEN_KEY = "planejamento:teacherToken";
// Sessão própria (não o ID token do Google, que expira em ~1h) — guardada em
// localStorage de propósito, pra persistir entre reaberturas do navegador.
// Só termina no logout explícito (POST /api/auth/logout).
const COORDINATOR_SESSION_KEY = "planejamento:coordinatorSession";

export function getTeacherToken(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("t");
  if (fromUrl) {
    localStorage.setItem(TEACHER_TOKEN_KEY, fromUrl);
    return fromUrl;
  }
  return localStorage.getItem(TEACHER_TOKEN_KEY) ?? "";
}

/**
 * True quando ESTA página foi aberta com ?t=... na URL — ou seja, quem está
 * vendo pediu explicitamente pra agir como aquela professora agora (inclui a
 * coordenadora abrindo o link de uma professora numa aba nova). Isso importa
 * porque localStorage é compartilhado entre abas: sem essa checagem, a
 * sessão da coordenadora (guardada em localStorage) "vazava" pra qualquer
 * aba nova, mesmo uma aberta a partir de um link de professora, fazendo a
 * tela do planejamento tentar entrar como coordenadora e falhar com "Link do
 * professor inválido".
 */
export function hasUrlTeacherToken(): boolean {
  return Boolean(new URLSearchParams(window.location.search).get("t"));
}

export function getCoordinatorSession(): string {
  return localStorage.getItem(COORDINATOR_SESSION_KEY) ?? "";
}

function setCoordinatorSession(sessionToken: string) {
  localStorage.setItem(COORDINATOR_SESSION_KEY, sessionToken);
}

function clearCoordinatorSessionLocal() {
  localStorage.removeItem(COORDINATOR_SESSION_KEY);
}

/** Troca o ID token do Google (curto) pela sessão própria (só termina no logout). */
export async function loginCoordinator(googleIdToken: string): Promise<void> {
  const { sessionToken } = await request<{ sessionToken: string }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ idToken: googleIdToken }),
  });
  setCoordinatorSession(sessionToken);
}

export async function logoutCoordinator(): Promise<void> {
  try {
    await request("/auth/logout", { method: "POST" });
  } finally {
    clearCoordinatorSessionLocal();
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");

  const teacherToken = getTeacherToken();
  const coordinatorSession = getCoordinatorSession();
  if (hasUrlTeacherToken() && teacherToken) headers.set("x-teacher-token", teacherToken);
  else if (coordinatorSession) headers.set("x-coordinator-session", coordinatorSession);
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

export interface SupervisorAnnotation {
  id: string;
  quote: string;
  note: string;
}

export interface SupervisorView {
  id: string;
  term: string;
  weekStart: string;
  coordMessage: string | null;
  teacher: { name: string; isEnglishTeacher: boolean };
  class: { name: string };
  days: LessonDay[];
  supervisorNote: { drawingDataUrl: string | null; annotations: SupervisorAnnotation[] } | null;
}

export const api = {
  me: () => request<Teacher>("/teachers/me"),

  supervisorView: (lessonWeekId: string) => request<SupervisorView>(`/supervisor/${lessonWeekId}`),

  saveSupervisorNote: (
    lessonWeekId: string,
    payload: { drawingDataUrl: string | null; annotations: SupervisorAnnotation[] },
  ) =>
    request<{ drawingDataUrl: string | null; annotations: SupervisorAnnotation[] }>(`/supervisor/${lessonWeekId}/note`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

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

  saveAgenda: (lessonWeekId: string, payload: { template: "infantil" | "fundamental"; imageUrl?: string | null }) =>
    request(`/agendas/${lessonWeekId}`, { method: "PUT", body: JSON.stringify(payload) }),

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
