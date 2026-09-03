import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type LessonDay } from "../lib/api";
import { WEEKDAYS } from "../lib/week";

const FIELDS: { key: keyof LessonDay; label: string }[] = [
  { key: "unitDay", label: "Disciplina / Unidade" },
  { key: "conteudo", label: "Conteúdo" },
  { key: "desenvolvimento", label: "Desenvolvimento da aula" },
  { key: "materiais", label: "Materiais" },
  { key: "tarefas", label: "Tarefas" },
];

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
}

// Página estática/impressão pro Supervisor (o "Advisor" do sistema antigo) —
// só leitura, com uma caneta interativa por cima pra rabiscar, salvar e
// imprimir com as anotações.
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
  // Ajusta o canvas pro tamanho real do conteúdo (com a resolução da tela,
  // pra não ficar borrado) e recarrega o rabisco salvo, se existir. Só roda
  // uma vez quando os dados chegam — redimensionar depois apagaria o que já
  // foi desenhado, e essa tela não é o tipo de coisa que fica sendo
  // redimensionada durante o uso normal (revisão/impressão).
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
  }, [week, isLoading]);

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

  async function saveNote() {
    if (!canvasRef.current) return;
    setSaveStatus("saving");
    try {
      const dataUrl = canvasRef.current.toDataURL("image/png");
      await api.saveSupervisorNote(lessonWeekId, dataUrl);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  }

  if (isLoading) return <p className="loading">Carregando…</p>;
  if (!week) return <p className="loading">Planejamento não encontrado.</p>;

  return (
    <div className="supervisor-page">
      <div className="supervisor-toolbar no-print">
        <strong>Caneta do Supervisor:</strong>
        <label>
          Cor <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <label>
          Espessura
          <input type="range" min={1} max={20} value={thickness} onChange={(e) => setThickness(Number(e.target.value))} />
        </label>
        <button type="button" onClick={clearCanvas}>Limpar rabisco</button>
        <button type="button" onClick={() => void saveNote()}>
          {saveStatus === "saving" ? "Salvando…" : "Salvar rabisco"}
        </button>
        <button type="button" onClick={() => window.print()}>Imprimir</button>
        {saveStatus === "saved" && <span className="hint">Salvo.</span>}
        {saveStatus === "error" && <span className="hint" style={{ color: "#b00020" }}>Falha ao salvar.</span>}
      </div>

      <div className="supervisor-content-wrap">
        <div ref={contentRef} className="supervisor-content">
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
                    <th colSpan={FIELDS.length}>
                      {weekday.label} — {new Date(dayRows[0].date).toLocaleDateString("pt-BR")}
                      {dayRows[0].isRecess ? " (Recesso)" : ""}
                    </th>
                  </tr>
                  <tr>
                    {FIELDS.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dayRows.map((day) => (
                    <tr key={`${day.date}-${day.slot}`}>
                      {FIELDS.map((f) => (
                        <td key={f.key}>{stripHtml(day[f.key] as string)}</td>
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
        </div>

        <canvas
          ref={canvasRef}
          className="supervisor-canvas"
          onPointerDown={startDraw}
          onPointerMove={moveDraw}
          onPointerUp={endDraw}
          onPointerLeave={endDraw}
        />
      </div>
    </div>
  );
}
