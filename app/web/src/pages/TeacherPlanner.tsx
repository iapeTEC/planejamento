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

export function TeacherPlanner() {
  const queryClient = useQueryClient();
  const { data: teacher } = useQuery({ queryKey: ["me"], queryFn: api.me });

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

  // Prefetch da semana anterior/seguinte pra troca instantânea (o ponto central do pedido de velocidade).
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

  if (!teacher) return <p className="loading">Carregando…</p>;

  function updateDay(index: number, field: keyof LessonDay, value: string) {
    setLocal((prev) => {
      const days = prev.days.slice();
      days[index] = { ...days[index], [field]: value };
      return { ...prev, days };
    });
    scheduleSave();
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

  const fields: { key: keyof LessonDay; label: string }[] = [
    { key: "unitDay", label: "Unidade, dia" },
    { key: "conteudo", label: "Conteúdo" },
    { key: "desenvolvimento", label: "Desenvolvimento da aula" },
    { key: "materiais", label: "Materiais para a aula" },
  ];
  if (!teacher.isEnglishTeacher) fields.push({ key: "tarefas", label: "Tarefas" });

  return (
    <div className="planner">
      <header className="planner-header">
        <h1>Planejamento — {teacher.name}</h1>
        <div className="week-controls">
          <button onClick={() => setWeekStart((d) => addDays(d, -7))}>◀</button>
          <strong>{weekLabel(weekStart)}</strong>
          <button onClick={() => setWeekStart((d) => addDays(d, 7))}>▶</button>
          {teacher.classes.length > 1 && (
            <select value={classId} onChange={(e) => setClassId(e.target.value)}>
              {teacher.classes.map(({ class: c }) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className={`save-status save-status--${status}`}>
          {status === "saving" && "Salvando…"}
          {status === "saved" && "Salvo"}
          {status === "dirty" && "Alterações não salvas…"}
          {status === "error" && "Não foi possível salvar agora — seus dados continuam guardados neste navegador."}
          {status === "idle" && " "}
          <button className="save-btn" onClick={() => void flush()}>
            Salvar
          </button>
          {weekQuery.data?.id && (
            <Link className="agenda-link" to={`/agenda/${weekQuery.data.id}?t=${getTeacherToken()}`}>
              Ir para Agenda →
            </Link>
          )}
        </div>
      </header>

      {teacher.isEnglishTeacher && (
        <p className="hint">
          Turma de inglês: preencha PPP (Presentation/Practice/Production) e as habilidades trabalhadas em cada dia.
        </p>
      )}

      <table className="lp-table">
        <thead>
          <tr>
            <th>Dia</th>
            {fields.map((f) => (
              <th key={f.key}>{f.label}</th>
            ))}
            {teacher.isEnglishTeacher && (
              <>
                <th>PPP</th>
                <th>Skills</th>
              </>
            )}
            <th>Agenda</th>
          </tr>
        </thead>
        <tbody>
          {local.days.map((day, index) => (
            <tr key={day.date}>
              <td className="day-cell">
                {day.weekday}
                <br />
                {new Date(day.date).getDate()}
              </td>
              {fields.map((f) => (
                <td key={f.key}>
                  <textarea
                    value={(day[f.key] as string) ?? ""}
                    onChange={(e) => updateDay(index, f.key, e.target.value)}
                    onBlur={() => void flush()}
                  />
                </td>
              ))}
              {teacher.isEnglishTeacher && (
                <>
                  <td className="ppp-cell">
                    {(["pppPresentation", "pppPractice", "pppProduction"] as const).map((key) => (
                      <label key={key}>
                        {key === "pppPresentation" ? "Presentation" : key === "pppPractice" ? "Practice" : "Production"}
                        <textarea
                          value={(day[key] as string) ?? ""}
                          onChange={(e) => updateDay(index, key, e.target.value)}
                          onBlur={() => void flush()}
                        />
                      </label>
                    ))}
                  </td>
                  <td className="skills-cell">
                    {(["skillListening", "skillWriting", "skillReading", "skillSpeaking"] as const).map((key) => (
                      <label key={key}>
                        {key.replace("skill", "")}
                        <textarea
                          value={(day[key] as string) ?? ""}
                          onChange={(e) => updateDay(index, key, e.target.value)}
                          onBlur={() => void flush()}
                        />
                      </label>
                    ))}
                  </td>
                </>
              )}
              <td className="agenda-cell">
                <button type="button" onClick={() => void generateAgendaWithAi(index)}>
                  Gerar por IA
                </button>
                <textarea
                  value={day.agendaHtml ?? ""}
                  onChange={(e) => updateDay(index, "agendaHtml", e.target.value)}
                  onBlur={() => void flush()}
                  placeholder="Texto da agenda para os pais…"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
