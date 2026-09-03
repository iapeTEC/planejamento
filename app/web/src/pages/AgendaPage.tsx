import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getCoordinatorSession, getTeacherToken, hasUrlTeacherToken } from "../lib/api";

interface AgendaDay {
  id: string;
  weekday: string;
  date: string;
  slot: number;
  isRecess: boolean;
  unitDay: string | null;
  agendaHtml: string | null;
  agendaGeneratedByAi: boolean;
}

interface AgendaResponse {
  id: string | null;
  template: "infantil" | "fundamental";
  imageUrl: string | null;
  lessonWeek: {
    weekStart: string;
    teacher: { name: string };
    class: { name: string };
    days: AgendaDay[];
  };
}

function authHeaders(): HeadersInit {
  const teacherToken = getTeacherToken();
  const coordinatorSession = getCoordinatorSession();
  const headers = new Headers();
  // Mesma prioridade de app.ts: se ESTA página foi aberta com ?t=..., age
  // como aquela professora mesmo que exista uma sessão de coordenação salva
  // no navegador (localStorage é compartilhado entre abas).
  if (hasUrlTeacherToken() && teacherToken) headers.set("x-teacher-token", teacherToken);
  else if (coordinatorSession) headers.set("x-coordinator-session", coordinatorSession);
  else if (teacherToken) headers.set("x-teacher-token", teacherToken);
  return headers;
}

async function fetchAgenda(lessonWeekId: string): Promise<AgendaResponse> {
  const resp = await fetch(`/api/agendas/${lessonWeekId}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error("Não foi possível carregar a agenda.");
  return resp.json();
}

function groupByDate(days: AgendaDay[]): { date: string; weekday: string; rows: AgendaDay[] }[] {
  const map = new Map<string, AgendaDay[]>();
  for (const day of days) {
    const list = map.get(day.date) ?? [];
    list.push(day);
    map.set(day.date, list);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => ({ date, weekday: rows[0].weekday, rows: rows.sort((a, b) => a.slot - b.slot) }));
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.${d.getUTCFullYear()}`;
}

// Reconstrói o modelo real de agenda semanal (Infantil / Fundamental) — grade
// Seg-Qui em 2 colunas + Sexta/recado numa linha só, bullets por disciplina
// (cada linha do planejamento vira um bullet aqui), editável e pronta pra
// imprimir. Igual à Agenda enviada aos pais hoje em papel.
export function AgendaPage() {
  const { lessonWeekId = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: agenda, isLoading, isError } = useQuery({
    queryKey: ["agenda", lessonWeekId],
    queryFn: () => fetchAgenda(lessonWeekId),
    enabled: Boolean(lessonWeekId),
  });

  const [genBusy, setGenBusy] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageBusy, setImageBusy] = useState(false);

  // Mesmo heartbeat do Planejamento — alimenta a bolinha verde/cinza da
  // coordenadora quando a professora abre a Agenda pelo próprio link.
  useEffect(() => {
    if (!getTeacherToken()) return;
    void api.heartbeat();
    const interval = setInterval(() => void api.heartbeat(), 20_000);
    return () => clearInterval(interval);
  }, []);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["agenda", lessonWeekId] });
  }

  async function saveAgendaText(dayId: string, text: string) {
    await api.patchLessonDay(dayId, { agendaHtml: text });
    invalidate();
  }

  async function generate(dayId: string) {
    setGenBusy(dayId);
    try {
      await api.generateAgendaWithAi(dayId);
      invalidate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao gerar por IA.");
    } finally {
      setGenBusy(null);
    }
  }

  async function uploadImage(file: File) {
    setImageBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.saveAgenda(lessonWeekId, { template: agenda!.template, imageUrl: dataUrl });
      invalidate();
    } catch {
      alert("Falha ao enviar a imagem.");
    } finally {
      setImageBusy(false);
    }
  }

  if (isLoading) return <p className="loading">Carregando…</p>;
  if (isError || !agenda) return <p className="loading">Agenda não encontrada.</p>;

  const groups = groupByDate(agenda.lessonWeek.days);
  const monThu = groups.filter((g) => g.weekday !== "SEX");
  const friday = groups.find((g) => g.weekday === "SEX");

  function renderDay(group: { date: string; weekday: string; rows: AgendaDay[] }) {
    const recess = group.rows.every((r) => r.isRecess);
    return (
      <section key={group.date} className="agenda-day-block">
        <h2>
          {group.weekday === "SEG" && "Segunda-feira"}
          {group.weekday === "TER" && "Terça-feira"}
          {group.weekday === "QUA" && "Quarta-feira"}
          {group.weekday === "QUI" && "Quinta-feira"}
          {group.weekday === "SEX" && "Sexta-feira"}
          {" – "}
          {fmtDate(group.date)}
        </h2>
        {recess ? (
          <p className="agenda-recess">Recesso</p>
        ) : (
          <ul className="agenda-bullets">
            {group.rows.map((row) => (
              <li key={row.id}>
                {stripHtml(row.unitDay) && <strong>{stripHtml(row.unitDay)}: </strong>}
                <span
                  className="agenda-bullet-text no-print-edit"
                  contentEditable
                  suppressContentEditableWarning
                  data-placeholder="Clique em Gerar por IA ou escreva o resumo pros pais…"
                  onBlur={(e) => void saveAgendaText(row.id, e.currentTarget.innerText.trim())}
                >
                  {row.agendaHtml || ""}
                </span>
                <button
                  type="button"
                  className="no-print agenda-ai-btn"
                  disabled={genBusy === row.id}
                  onClick={() => void generate(row.id)}
                >
                  {genBusy === row.id ? "Gerando…" : "Gerar por IA"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="agenda-page">
      <div className="agenda-toolbar no-print">
        <button type="button" onClick={() => window.print()}>Imprimir / Salvar PDF</button>
      </div>

      <div className={`agenda-sheet agenda-sheet--${agenda.template}`}>
        <header className="agenda-sheet-header">
          <img className="agenda-logo" src="/cabecalho.png" alt="Cabeçalho" />
          <div className="agenda-title-box">
            <div className="agenda-title-line">AGENDA SEMANAL</div>
            {agenda.template === "fundamental" && <div className="agenda-title-line">ENSINO FUNDAMENTAL</div>}
            <div className="agenda-title-line agenda-title-class">{agenda.lessonWeek.class.name}</div>
          </div>
        </header>
        <div className="agenda-teacher-row">
          {agenda.template === "infantil" ? "PROFESSORA " : "PROFESSOR REGENTE: "}
          {agenda.lessonWeek.teacher.name}
        </div>

        <div className="agenda-grid-2col">{monThu.map(renderDay)}</div>

        <div className="agenda-friday-row">
          {friday ? renderDay(friday) : <div />}
          <section className="agenda-image-box">
            <h2>Recado</h2>
            {agenda.imageUrl ? (
              <img src={agenda.imageUrl} alt="Recado da semana" className="agenda-recado-img" />
            ) : (
              <p className="hint">Nenhuma imagem enviada ainda.</p>
            )}
            <button
              type="button"
              className="no-print"
              disabled={imageBusy}
              onClick={() => fileInputRef.current?.click()}
            >
              {imageBusy ? "Enviando…" : agenda.imageUrl ? "Trocar imagem" : "Enviar imagem"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="no-print"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
                e.target.value = "";
              }}
            />
          </section>
        </div>

        <p className="agenda-footer-note">IMPORTANTE! PLANEJAMENTO SUJEITO A ALTERAÇÕES.</p>
      </div>
    </div>
  );
}
