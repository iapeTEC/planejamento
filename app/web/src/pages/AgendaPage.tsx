import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, getCoordinatorSession, getTeacherToken, hasUrlTeacherToken } from "../lib/api";

interface AgendaResponse {
  id: string;
  template: "infantil" | "fundamental";
  imageUrl: string | null;
  lessonWeek: {
    weekStart: string;
    teacher: { name: string };
    class: { name: string };
    days: { id: string; weekday: string; date: string; agendaHtml: string | null }[];
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

async function fetchAgenda(lessonWeekId: string): Promise<AgendaResponse | null> {
  const resp = await fetch(`/api/agendas/${lessonWeekId}`, { headers: authHeaders() });
  if (!resp.ok) throw new Error("Não foi possível carregar a agenda.");
  return resp.json();
}

// NOTA: layout ainda não é pixel-perfect aos modelos originais (Infantil /
// Fundamental) — isso é trabalho de refinamento visual (ver ARCHITECTURE.md
// secao 7). Aqui já está a estrutura funcional: dias, conteúdo da agenda por
// dia, edição, e o botão de PDF (que hoje devolve 501 - geração via
// Playwright ainda não implementada).
export function AgendaPage() {
  const { lessonWeekId = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: agenda, isLoading } = useQuery({
    queryKey: ["agenda", lessonWeekId],
    queryFn: () => fetchAgenda(lessonWeekId),
    enabled: Boolean(lessonWeekId),
  });

  // Mesmo heartbeat do Planejamento — alimenta a bolinha verde/cinza da
  // coordenadora quando a professora abre a Agenda pelo próprio link.
  useEffect(() => {
    if (!getTeacherToken()) return;
    void api.heartbeat();
    const interval = setInterval(() => void api.heartbeat(), 20_000);
    return () => clearInterval(interval);
  }, []);

  const [pdfMessage, setPdfMessage] = useState("");

  async function downloadPdf() {
    const resp = await fetch(`/api/agendas/${lessonWeekId}/pdf`, { method: "POST" });
    if (resp.status === 501) {
      setPdfMessage("Exportação em PDF ainda não está pronta (Fase 4 em andamento).");
      return;
    }
    setPdfMessage("");
  }

  if (isLoading) return <p className="loading">Carregando…</p>;
  if (!agenda) return <p>Agenda não encontrada.</p>;

  return (
    <div className={`agenda agenda--${agenda.template}`}>
      <header>
        <h1>Agenda semanal — {agenda.lessonWeek.class.name}</h1>
        <p>
          Professor(a) regente: {agenda.lessonWeek.teacher.name}
        </p>
        <button onClick={() => void downloadPdf()}>Baixar PDF</button>
        {pdfMessage && <p className="hint">{pdfMessage}</p>}
      </header>

      <div className="agenda-grid">
        {agenda.lessonWeek.days.map((day) => (
          <section key={day.date} className="agenda-day">
            <h2>
              {day.weekday} — {new Date(day.date).toLocaleDateString("pt-BR")}
            </h2>
            <div
              className="agenda-day-content"
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => {
                const text = e.currentTarget.innerText;
                void api
                  .patchLessonDay(day.id, { agendaHtml: text })
                  .then(() => queryClient.invalidateQueries({ queryKey: ["agenda", lessonWeekId] }));
              }}
            >
              {day.agendaHtml || "(sem conteúdo ainda)"}
            </div>
          </section>
        ))}
      </div>

      <section className="agenda-image">
        <h2>Recado da semana</h2>
        {agenda.imageUrl ? <img src={agenda.imageUrl} alt="Recado" /> : <p>Nenhuma imagem enviada ainda.</p>}
        {/* TODO: upload de arquivo de verdade precisa de um endpoint de assets (S3/minio ou disco na VM). */}
      </section>
    </div>
  );
}
