import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type LessonDay } from "../lib/api";
import { WEEKDAYS } from "../lib/week";

interface Annotation {
  id: string;
  quote: string;
  note: string;
}

const BASE_FIELDS: { key: keyof LessonDay; label: string }[] = [
  { key: "unitDay", label: "Disciplina / Unidade" },
  { key: "conteudo", label: "Conteúdo" },
  { key: "desenvolvimento", label: "Desenvolvimento da aula" },
  { key: "materiais", label: "Materiais" },
  { key: "tarefas", label: "Tarefas" },
];

// Turmas de inglês não usam o campo "desenvolvimento" pra digitar — o
// conteúdo real da aula fica espalhado no PPP e nas competências. A versão
// do Supervisor precisa juntar tudo isso na coluna "Desenvolvimento da
// aula", senão fica em branco justamente o que ele mais precisa ver.
const ENGLISH_DEV_FIELDS: { key: keyof LessonDay; label: string }[] = [
  { key: "pppPresentation", label: "Presentation" },
  { key: "pppPractice", label: "Practice" },
  { key: "pppProduction", label: "Production" },
  { key: "skillListening", label: "Listening" },
  { key: "skillWriting", label: "Writing" },
  { key: "skillReading", label: "Reading" },
  { key: "skillSpeaking", label: "Speaking" },
];

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

function developmentContent(day: LessonDay, isEnglishTeacher: boolean): string {
  if (!isEnglishTeacher) return stripHtml(day.desenvolvimento);
  return ENGLISH_DEV_FIELDS.map((f) => {
    const value = stripHtml(day[f.key] as string | undefined);
    return value ? `${f.label}: ${value}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

function fieldContent(day: LessonDay, key: keyof LessonDay, isEnglishTeacher: boolean): string {
  if (key === "desenvolvimento") return developmentContent(day, isEnglishTeacher);
  return stripHtml(day[key] as string | undefined);
}

// Página estática/impressão pro Supervisor (o "Advisor" do sistema antigo) —
// só leitura, com uma caneta interativa e anotações por seleção de texto,
// salvas e prontas pra imprimir.
export function SupervisorPage() {
  const { lessonWeekId = "" } = useParams();
  const { data: week, isLoading } = useQuery({
    queryKey: ["supervisor", lessonWeekId],
    queryFn: () => api.supervisorView(lessonWeekId),
    enabled: Boolean(lessonWeekId),
  });

  const contentRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState("#e21f1f");
  const [thickness, setThickness] = useState(4);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // O canvas fica por cima de tudo pra desenhar — se ficasse sempre
  // "clicável" nunca daria pra selecionar texto embaixo pra anotar. Por
  // isso alterna entre os dois modos.
  const [mode, setMode] = useState<"draw" | "select">("select");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [pendingRect, setPendingRect] = useState<DOMRect | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const pendingRangeRef = useRef<Range | null>(null);
  const appliedHighlightsRef = useRef(false);

  // Ajusta o canvas pro tamanho real do conteúdo e recarrega o rabisco
  // salvo, se existir. Só roda uma vez quando os dados chegam.
  useEffect(() => {
    if (!week || isLoading) return;
    const canvas = canvasRef.current;
    const content = contentRef.current;
    if (!canvas || !content) return;

    const rect = content.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    ctx?.scale(ratio, ratio);

    const savedDrawing = week.supervisorNote?.drawingDataUrl;
    if (savedDrawing && ctx) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = savedDrawing;
    }

    const saved = week.supervisorNote?.annotations ?? [];
    setAnnotations(saved);
  }, [week, isLoading]);

  // Reaplica o destaque amarelo das anotações salvas assim que o conteúdo
  // (texto real do planejamento) estiver renderizado — procura a citação
  // salva no texto e embrulha num <mark>.
  useEffect(() => {
    if (appliedHighlightsRef.current) return;
    if (!annotations.length || !contentRef.current) return;
    for (const annotation of annotations) {
      applyHighlightByQuote(contentRef.current, annotation.quote, annotation.id, annotation.note);
    }
    appliedHighlightsRef.current = true;
  }, [annotations]);

  function wrapRange(range: Range, id: string, note: string) {
    const mark = document.createElement("mark");
    mark.className = "supervisor-highlight";
    mark.dataset.annotationId = id;
    // Vira o balão que aparece ao passar o mouse (ver .supervisor-highlight
    // no CSS) — sem precisar de JS extra pra mostrar/esconder.
    mark.dataset.note = note;
    try {
      range.surroundContents(mark);
    } catch {
      // Seleção atravessa mais de um elemento — não dá pra embrulhar com
      // segurança sem bagunçar o layout. A anotação continua salva, só não
      // aparece destacada em amarelo nesse caso raro.
    }
  }

  function applyHighlightByQuote(root: HTMLElement, quote: string, id: string, note: string) {
    if (!quote) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    // eslint-disable-next-line no-cond-assign
    while ((node = walker.nextNode() as Text | null)) {
      const idx = node.data.indexOf(quote);
      if (idx === -1) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + quote.length);
      wrapRange(range, id, note);
      return;
    }
  }

  function handleContentMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const text = selection.toString().trim();
    if (!text || !contentRef.current?.contains(selection.anchorNode)) return;
    const range = selection.getRangeAt(0).cloneRange();
    pendingRangeRef.current = range;
    setPendingRect(range.getBoundingClientRect());
    setNoteDraft("");
  }

  async function persist(nextAnnotations: Annotation[], drawingDataUrl?: string) {
    setSaveStatus("saving");
    try {
      await api.saveSupervisorNote(lessonWeekId, {
        drawingDataUrl: drawingDataUrl ?? week?.supervisorNote?.drawingDataUrl ?? null,
        annotations: nextAnnotations,
      });
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  function confirmAnnotation() {
    if (!noteDraft.trim() || !pendingRangeRef.current) {
      setPendingRect(null);
      return;
    }
    const id = crypto.randomUUID();
    const quote = pendingRangeRef.current.toString();
    wrapRange(pendingRangeRef.current, id, noteDraft.trim());
    const next = [...annotations, { id, quote, note: noteDraft.trim() }];
    setAnnotations(next);
    setPendingRect(null);
    setNoteDraft("");
    window.getSelection()?.removeAllRanges();
    void persist(next);
  }

  function removeAnnotation(id: string) {
    document.querySelectorAll(`mark[data-annotation-id="${id}"]`).forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) parent?.insertBefore(el.firstChild, el);
      parent?.removeChild(el);
    });
    const next = annotations.filter((a) => a.id !== id);
    setAnnotations(next);
    void persist(next);
  }

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = getPos(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = thickness;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function moveDraw(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const { x, y } = getPos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function endDraw() {
    drawing.current = false;
  }

  function clearCanvas() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function saveEverything() {
    if (!canvasRef.current) return;
    await persist(annotations, canvasRef.current.toDataURL("image/png"));
  }

  if (isLoading) return <p className="loading">Carregando…</p>;
  if (!week) return <p className="loading">Planejamento não encontrado.</p>;

  const isEnglishTeacher = week.teacher.isEnglishTeacher;

  return (
    <div className="supervisor-page">
      <div className="supervisor-toolbar no-print">
        <div className="mode-toggle">
          <button type="button" className={mode === "select" ? "mode-active" : ""} onClick={() => setMode("select")}>
            🖊️ Selecionar texto
          </button>
          <button type="button" className={mode === "draw" ? "mode-active" : ""} onClick={() => setMode("draw")}>
            ✏️ Desenhar
          </button>
        </div>
        <strong>Caneta:</strong>
        <label>
          Cor <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label>
          Espessura
          <input type="range" min={1} max={20} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
        </label>
        <button type="button" onClick={clearCanvas}>Limpar rabisco</button>
        <button type="button" onClick={() => void saveEverything()}>
          {saveStatus === "saving" ? "Salvando…" : "Salvar tudo"}
        </button>
        <button type="button" onClick={() => window.print()}>Imprimir</button>
        {saveStatus === "saved" && <span className="hint">Salvo.</span>}
        {saveStatus === "error" && <span className="hint" style={{ color: "#b00020" }}>Falha ao salvar.</span>}
        <span className="hint">Selecione um trecho do texto pra adicionar uma anotação.</span>
      </div>

      <div className="supervisor-content-wrap">
        <div ref={contentRef} className="supervisor-content" onMouseUp={handleContentMouseUp}>
          <h1>
            Planejamento — {week.class.name} — {week.teacher.name}
          </h1>
          <p>
            {week.term}º Bimestre · Semana de {new Date(week.weekStart).toLocaleDateString("pt-BR")}
          </p>

          {WEEKDAYS.map((weekday) => {
            const dayRows = week.days.filter((d) => d.weekday === weekday.key);
            if (!dayRows.length) return null;
            return (
              <table key={weekday.key} className="supervisor-table">
                <thead>
                  <tr>
                    <th colSpan={BASE_FIELDS.length}>
                      {weekday.label} — {new Date(dayRows[0].date).toLocaleDateString("pt-BR")}
                      {dayRows[0].isRecess ? " (Recesso)" : ""}
                    </th>
                  </tr>
                  <tr>
                    {BASE_FIELDS.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((day) => (
                    <tr key={`${day.date}-${day.slot}`}>
                      {BASE_FIELDS.map((f) => (
                        <td key={f.key} className="supervisor-cell">
                          {fieldContent(day, f.key, isEnglishTeacher)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })}

          {week.coordMessage && (
            <p className="supervisor-coord">
              <strong>Mensagem da coordenação:</strong> {stripHtml(week.coordMessage)}
            </p>
          )}

          {annotations.length > 0 && (
            <div className="supervisor-annotation-list">
              <h2>Anotações do Supervisor</h2>
              <ol>
                {annotations.map((a, i) => (
                  <li key={a.id}>
                    <strong>{i + 1}.</strong> "{a.quote}" — {a.note}{" "}
                    <button type="button" className="no-print annotation-remove" onClick={() => removeAnnotation(a.id)}>
                      remover
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <canvas
          ref={canvasRef}
          className="supervisor-canvas"
          style={{ pointerEvents: mode === "draw" ? "auto" : "none" }}
          onPointerDown={startDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />
      </div>

      {pendingRect && (
        <div
          className="annotation-popover no-print"
          style={{ top: pendingRect.bottom + window.scrollY + 6, left: pendingRect.left + window.scrollX }}
        >
          <textarea
            autoFocus
            placeholder="Escreva a anotação…"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
          />
          <div className="annotation-popover-actions">
            <button type="button" onClick={confirmAnnotation}>Adicionar</button>
            <button type="button" onClick={() => setPendingRect(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
