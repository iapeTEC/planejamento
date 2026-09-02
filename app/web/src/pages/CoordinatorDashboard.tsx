import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Teacher } from "../lib/api";
import { clearCoordinatorIdToken, getCoordinatorIdToken, setCoordinatorIdToken } from "../lib/api";
import { renderGoogleSignInButton } from "../lib/googleAuth";

function whatsappLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}`;
}

function magicLink(token: string): string {
  return `${window.location.origin}/planejamento?t=${token}`;
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      void renderGoogleSignInButton(ref.current, (idToken) => {
        setCoordinatorIdToken(idToken);
        onSignedIn();
      });
    }
  }, [onSignedIn]);
  return (
    <div className="signin">
      <p>Entre com o Gmail cadastrado como coordenação.</p>
      <div ref={ref} />
    </div>
  );
}

function TeacherRow({ teacher, onChanged }: { teacher: Teacher; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(teacher.name);
  const [phone, setPhone] = useState(teacher.phone ?? "");

  async function save() {
    await api.updateTeacher(teacher.id, { name, phone });
    setEditing(false);
    onChanged();
  }

  async function toggleActive() {
    await api.updateTeacher(teacher.id, { active: !teacher.active });
    onChanged();
  }

  async function remove() {
    if (!confirm(`Excluir ${teacher.name}? Essa ação não pode ser desfeita.`)) return;
    await api.deleteTeacher(teacher.id);
    onChanged();
  }

  return (
    <tr className={teacher.active ? "" : "inactive"}>
      <td>
        {editing ? (
          <input value={name} onChange={(e) => setName(e.target.value)} />
        ) : (
          <>
            {teacher.name}
            {teacher.isEnglishTeacher && <span className="badge">Inglês</span>}
          </>
        )}
      </td>
      <td>{teacher.classes.map(({ class: c }) => c.name).join(", ")}</td>
      <td>
        {editing ? (
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="55849..." />
        ) : teacher.phone ? (
          <a href={whatsappLink(teacher.phone)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        ) : (
          "—"
        )}
      </td>
      <td>
        <a href={magicLink(teacher.magicToken)} target="_blank" rel="noreferrer">
          Planejamento
        </a>
      </td>
      <td>{teacher.active ? "Ativa" : "Inativa"}</td>
      <td className="actions">
        {editing ? (
          <button onClick={() => void save()}>Salvar</button>
        ) : (
          <button onClick={() => setEditing(true)}>Editar</button>
        )}
        <button onClick={() => void toggleActive()}>{teacher.active ? "Desativar" : "Ativar"}</button>
        <button className="danger" onClick={() => void remove()}>
          Excluir
        </button>
      </td>
    </tr>
  );
}

function AddTeacherForm({ onAdded }: { onAdded: () => void }) {
  const classesQuery = useQuery({ queryKey: ["classes"], queryFn: api.listClasses });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isEnglishTeacher, setIsEnglishTeacher] = useState(false);
  const [classIds, setClassIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function toggleClass(id: string) {
    setClassIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || classIds.length === 0) {
      alert("Nome e ao menos uma turma são obrigatórios.");
      return;
    }
    setBusy(true);
    try {
      await api.createTeacher({ name, phone: phone || undefined, isEnglishTeacher, classIds });
      setName("");
      setPhone("");
      setIsEnglishTeacher(false);
      setClassIds([]);
      onAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Falha ao cadastrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-teacher" onSubmit={(e) => void submit(e)}>
      <h3>Cadastrar professora</h3>
      <input placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Telefone (WhatsApp)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label>
        <input type="checkbox" checked={isEnglishTeacher} onChange={(e) => setIsEnglishTeacher(e.target.checked)} />
        Professora de inglês
      </label>
      <fieldset>
        <legend>Turmas</legend>
        {classesQuery.data?.map((c) => (
          <label key={c.id}>
            <input type="checkbox" checked={classIds.includes(c.id)} onChange={() => toggleClass(c.id)} />
            {c.name}
          </label>
        ))}
      </fieldset>
      <button type="submit" disabled={busy}>
        {busy ? "Cadastrando…" : "Adicionar professora"}
      </button>
    </form>
  );
}

export function CoordinatorDashboard() {
  const [authed, setAuthed] = useState(Boolean(getCoordinatorIdToken()));
  const queryClient = useQueryClient();

  const teachersQuery = useQuery({
    queryKey: ["teachers"],
    queryFn: api.listTeachers,
    enabled: authed,
  });

  function onChanged() {
    void queryClient.invalidateQueries({ queryKey: ["teachers"] });
  }

  if (!authed) {
    return <SignIn onSignedIn={() => setAuthed(true)} />;
  }

  return (
    <div className="dashboard">
      <header>
        <h1>Coordenação</h1>
        <button
          onClick={() => {
            clearCoordinatorIdToken();
            setAuthed(false);
          }}
        >
          Sair
        </button>
      </header>

      <section>
        <h2>Professoras</h2>
        <AddTeacherForm onAdded={onChanged} />
        {teachersQuery.isLoading && <p>Carregando…</p>}
        {teachersQuery.data && (
          <table className="teachers-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Turmas</th>
                <th>Contato</th>
                <th>Link</th>
                <th>Status</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {teachersQuery.data.map((t) => (
                <TeacherRow key={t.id} teacher={t} onChanged={onChanged} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
