import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, getTeacherToken, type LessonDay } from "../lib/api";
import { loadDraft, useAutosave, type WeekDraft } from "../lib/useAutosave";
import { addDays, mondayOf, toISODate, weekLabel, WEEKDAYS } from "../lib/week";

function emptyDays(weekStart: Date): LessonDay[] {
  return WEEKDAYS.map((w, i) => ({
    weekday: w.label,
    date: toISODate(addDays(weekStart, i)),
    slot: 0,
  }));
}

function mergeDays(base: LessonDay[], weekStart: Date): LessonDay[] {
  return WEEKDAYS.map((w, i) => {
    const date = toISODate(addDays(weekStart, i));
    const found = base.find((d) => d.date === date);
    return found ?? { weekday: w.label, date, slot: 0 };
  });
}

function dateNumber(isoDate: string): number {
  return Number(isoDate.slice(-2));
}

const GENERAL_FIELDS: { key: keyof LessonDay; label: string }[] = [
  { key: "unitDay", label: "Disciplina" },
  { key: "conteudo", label: "Conteúdo" },
  { key: "desenvolvimento", label: "Desenvolvimento da aula" },
  { key: "materiais", label: "Materiais para a aula" },
  { key: "tarefas", label: "Tarefas" },
];

const ENGLISH_FIELDS: { key: keyof LessonDay; label: string; className?: string }[] = [
  { key: "unitDay", label: "Unit, Day" },
  { key: "conteudo", label: "Conteúdo" },
  { key: "desenvolvimento", label: "Desenvolvimento da aula", className: "dev-english-cell" },
  { key: "materiais", label: "Materiais para a aula" },
];

export function TeacherPlanner() {
  const queryClient = useQueryClient();
  const { data: teacher, isError: meError, error: meErrorDetail } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    retry: false,
    enabled: Boolean(getTeacherToken()),
  });

  const [classId, setClassId] = useState<string>("");
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const weekStartIso = toISODate(weekStart);

  useEffect(() => {
    if (teacher && !classId && teacher.classes.length) {
      setClassId(teacher.classes[0].class.id);
    }
  }, [teacher, classId]);

  const weekQuery = useQuery({
    queryKey: ["lesson-week", classId, weekStartIso],
    queryFn: () => api.lessonWeek(classId, weekStartIso),
    enabled: Boolean(classId),
  });

  useEffect(() => {
    if (!classId) return;
    for (const offset of [-7, 7]) {
      const iso = toISODate(addDays(weekStart, offset));
      void queryClient.prefetchQuery({
        queryKey: ["lesson-week", classId, iso],
        queryFn: () => api.lessonWeek(classId, iso),
      });
    }
  }, [classId, weekStart, queryClient]);

  const draft: WeekDraft = useMemo(() => {
    const fromDraft = classId ? loadDraft(classId, weekStartIso) : null;
    if (fromDraft) return fromDraft;
    return {
      classId,
      term: weekQuery.data?.term ?? "1",
      weekStart: weekStartIso,
      coordMessage: weekQuery.data?.coordMessage ?? "",
      days: weekQuery.data ? mergeDays(weekQuery.data.days, weekStart) : emptyDays(weekStart),
    };
  }, [classId, weekStartIso, weekQuery.data, weekStart]);

  const [local, setLocal] = useState<WeekDraft>(draft);
  useEffect(() => setLocal(draft), [draft]);

  const { status, scheduleSave, flush } = useAutosave(local);

  if (!getTeacherToken()) {
    return <p className="loading">Abra pelo link enviado pela coordenação para acessar seu planejamento.</p>;
  }

  if (meError) {
    return (
      <p className="loading">
        {meErrorDetail instanceof Error ? meErrorDetail.message : "Não foi possível carregar seu cadastro."}
      </p>
    );
  }

  if (!teacher) return <p className="loading">Carregando…</p>;

  const currentTeacher = teacher;
  const selectedClass = teacher.classes.find(({ class: c }) => c.id === classId)?.class;
  const selectedClassIndex = teacher.classes.findIndex(({ class: c }) => c.id === classId);
  const modeClass = teacher.isEnglishTeacher ? "english-teacher" : "non-english";

  function updateDay(index: number, field: keyof LessonDay, value: string) {
    setLocal((prev) => {
      const days = prev.days.slice();
      days[index] = { ...days[index], [field]: value };
      return { ...prev, days };
    });
    scheduleSave();
  }

  function updateCoordMessage(value: string) {
    setLocal((prev) => ({ ...prev, coordMessage: value }));
    scheduleSave();
  }

  function moveClass(direction: number) {
    if (currentTeacher.classes.length < 2) return;
    const next = (selectedClassIndex + direction + currentTeacher.classes.length) % currentTeacher.classes.length;
    setClassId(currentTeacher.classes[next].class.id);
  }

  async function generateAgendaWithAi(index: number) {
    const day = local.days[index];
    if (!day.id) {
      alert("Salve o planejamento primeiro (clique em Salvar) antes de gerar a Agenda por IA.");
      return;
    }
    try {
      const { text } = await api.generateAgendaWithAi(day.id);
      updateDay(index, "agendaHtml", text);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao gerar a Agenda por IA.");
    }
  }

  function fieldEditor(day: LessonDay, index: number, key: keyof LessonDay, className?: string) {
    if (key === "desenvolvimento" && currentTeacher.isEnglishTeacher) {
      return (
        <div className={className}>
          <textarea
            className="rich"
            value={day.desenvolvimento ?? ""}
            onChange={(e) => updateDay(index, "desenvolvimento", e.target.value)}
            onBlur={() => void flush()}
            aria-label="Desenvolvimento da aula"
          />
          <div className="ppp-block">
            <strong>PPP</strong>
            {(["pppPresentation", "pppPractice", "pppProduction"] as const).map((keyName) => (
              <label key={keyName}>
                {keyName === "pppPresentation" ? "Presentation" : keyName === "pppPractice" ? "Practice" : "Production"}
                <textarea
                  value={day[keyName] ?? ""}
                  onChange={(e) => updateDay(index, keyName, e.target.value)}
                  onBlur={() => void flush()}
                />
              </label>
            ))}
          </div>
          <div className="skills-block">
            <strong>Skills</strong>
            {(["skillListening", "skillWriting", "skillReading", "skillSpeaking"] as const).map((keyName) => (
              <label key={keyName}>
                {keyName.replace("skill", "")}
                <textarea
                  value={day[keyName] ?? ""}
                  onChange={(e) => updateDay(index, keyName, e.target.value)}
                  onBlur={() => void flush()}
                />
              </label>
            ))}
          </div>
        </div>
      );
    }

    return (
      <textarea
        className="rich"
        value={(day[key] as string) ?? ""}
        onChange={(e) => updateDay(index, key, e.target.value)}
        onBlur={() => void flush()}
        aria-label={String(key)}
      />
    );
  }

  function agendaEditor(day: LessonDay, index: number) {
    return (
      <div className="agenda-cell-content">
        <button type="button" onClick={() => void generateAgendaWithAi(index)}>Gerar por IA</button>
        <textarea
          className="rich"
          value={day.agendaHtml ?? ""}
          onChange={(e) => updateDay(index, "agendaHtml", e.target.value)}
          onBlur={() => void flush()}
          placeholder="Texto da agenda para os pais…"
          aria-label="Agenda"
        />
      </div>
    );
  }

  return (
    <main className={modeClass}>
      <div className="page teacher-page">
        <header className="hero">
          <div className="hero-bg">
            <img
              className="hero-img"
              src={teacher.isEnglishTeacher ? "/header.png" : "/cabecalho.png"}
              alt={teacher.isEnglishTeacher ? "Cabeçalho do Programa Bilíngue" : "Cabeçalho do Planejamento"}
            />
          </div>
          <div className="hero-content">
            <div className="hero-center">
              <span className="pill pill-primary pill-static">{local.term}º Bimestre - LIVRO/TURMA</span>
              <div className="meta">
                <div className="meta-line">
                  <span className="meta-label">Professor:</span>
                  <span className="meta-value">{teacher.name}</span>
                </div>
                <div className="meta-line">
                  {teacher.isEnglishTeacher && <span className="meta-label">Programa Bilíngue -</span>}
                  <span className="meta-label">DATA:</span>
                  <span className="meta-value">{weekLabel(weekStart)}</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="top-actions">
          <div className="week-nav">
            <button className="nav-btn" type="button" aria-label="Semana anterior" onClick={() => setWeekStart((d) => addDays(d, -7))}>‹</button>
            <span className="pill pill-week pill-static"><span className="tick" /><span>({weekLabel(weekStart)})</span></span>
            <button className="nav-btn" type="button" aria-label="Próxima semana" onClick={() => setWeekStart((d) => addDays(d, 7))}>›</button>
          </div>

          <div className="actions-right">
            <span className={`save-feedback save-feedback--${status}`} aria-live="polite">
              {status === "saving" && "Salvando…"}
              {status === "saved" && "Salvo"}
              {status === "dirty" && "Alterações não salvas…"}
              {status === "error" && "Não foi possível salvar agora"}
            </span>
            <button className="btn btn-ghost" type="button" onClick={() => void flush()}>Salvar</button>
            {weekQuery.data?.id && (
              <Link className="btn btn-primary agenda-link" to={`/agenda/${weekQuery.data.id}?t=${getTeacherToken()}`}>Ir para Agenda</Link>
            )}
          </div>
        </div>

        <div className="title-row">
          <div className="lesson-title">{teacher.isEnglishTeacher ? "LESSON PREP" : "PLANEJAMENTO"}</div>
          <div className="class-nav">
            {teacher.classes.length > 1 && <button className="nav-btn" type="button" aria-label="Turma anterior" onClick={() => moveClass(-1)}>‹</button>}
            <span className="pill pill-week class-btn pill-static">Turma: {selectedClass?.name ?? ""}</span>
            {teacher.classes.length > 1 && <button className="nav-btn" type="button" aria-label="Próxima turma" onClick={() => moveClass(1)}>›</button>}
          </div>
        </div>

        <section className="sheet-wrap">
          <div className="sheet">
            <div className="sheet-inner">
              {teacher.isEnglishTeacher ? (
                <table className="lp-table english-table">
                  <colgroup>
                    <col className="col-unit" />
                    <col className="col-content" />
                    <col className="col-dev" />
                    <col className="col-mat" />
                    <col className="col-agenda" />
                  </colgroup>
                  <thead><tr>{ENGLISH_FIELDS.map((field) => <th key={field.key}>{field.label}</th>)}<th>Agenda</th></tr></thead>
                  <tbody>
                    {local.days.map((day, index) => (
                      <tr key={day.date}>
                        {ENGLISH_FIELDS.map((field, fieldIndex) => (
                          <td key={field.key} className={fieldIndex === 0 ? "td-unit" : field.className}>
                            {fieldIndex === 0 && (
                              <div className="day-badge" aria-hidden="true"><span className="dayNum">{dateNumber(day.date)}</span><span className="weekPill">{day.weekday}</span></div>
                            )}
                            {fieldEditor(day, index, field.key, field.className)}
                          </td>
                        ))}
                        <td className="agenda-cell">{agendaEditor(day, index)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="general-week">
                  {local.days.map((day, index) => (
                    <section className="general-day-block" key={day.date}>
                      <div className="general-day-marker">
                        <div className="day-badge" aria-hidden="true"><span className="dayNum">{dateNumber(day.date)}</span><span className="weekPill">{day.weekday}</span></div>
                      </div>
                      <div className="general-day-rows">
                        <div className="general-header">
                          {GENERAL_FIELDS.map((field) => <div className="general-th" key={field.key}>{field.label}</div>)}
                          <div className="general-th">Agenda</div>
                        </div>
                        <div className="general-row">
                          {GENERAL_FIELDS.map((field) => (
                            <div className="general-td" data-label={field.label} key={field.key}>{fieldEditor(day, index, field.key)}</div>
                          ))}
                          <div className="general-td agenda-cell" data-label="Agenda">{agendaEditor(day, index)}</div>
                        </div>
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="coord">
          <div className="coord-label">{teacher.isEnglishTeacher ? "COORDINATION MESSAGE:" : "MENSAGEM DA COORDENAÇÃO:"}</div>
          <div className="coord-box">
            <textarea className="coord-edit rich" value={local.coordMessage} onChange={(e) => updateCoordMessage(e.target.value)} onBlur={() => void flush()} aria-label="Mensagem da coordenação" />
          </div>
        </section>
      </div>
    </main>
  );
}
