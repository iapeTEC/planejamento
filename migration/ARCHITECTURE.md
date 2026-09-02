# Planejamento IAPE — Arquitetura da Nova Plataforma (Fase 2)

Documento para aprovação antes de iniciar a implementação. Baseado na análise do
sistema atual (`iapeTEC/planejamento` + Apps Script ao vivo, ID `18sfeb7VW7WKl3hB7a6m4Ie3Zf1727PrhPVND6Zndo0ASwoTFfym6nhpu`)
e dos modelos de agenda (`AG - 24 a 28 de Agosto.pdf` / Infantil, `5º ano - Agenda semanal 24 a 280826.pdf` / Fundamental).

## 1. Stack

- **Backend**: Node.js + Express (ou Fastify) + TypeScript, Prisma como ORM.
- **Banco**: PostgreSQL.
- **Frontend**: React + Vite, React Query para cache/sincronização, TipTap (ou similar) para os campos ricos que hoje são `contenteditable`.
- **Geração de PDF**: Playwright headless no servidor renderizando um componente React do template exato (Infantil/Fundamental) → PDF. Pixel-perfect porque é o mesmo HTML/CSS que a tela mostra.
- **Fila de IA**: um worker simples (BullMQ + Redis, ou tabela `ai_jobs` com polling — decido pelo tamanho real da carga) que chama o Codex rodando na VM.
- **Deploy**: Docker Compose na VM `iape` (10.41.25.10) — containers `api`, `web` (build estático servido por Nginx), `postgres`, `redis` (se usado), Nginx como reverse proxy + Certbot para TLS.

## 2. Modelo de dados (Postgres)

```
schools            (id, name)                                  -- só 1 registro por ora
users              (id, email, role: 'coordinator', google_sub) -- Nayara + Norma
teachers           (id, name, phone, photo_url, is_english_teacher,
                     active, magic_token, created_at)
classes            (id, name, level: 'infantil' | 'fundamental')
teacher_classes    (teacher_id, class_id)                       -- N:N (Bruno = 4º e 6º Ano)
lesson_weeks       (id, teacher_id, class_id, week_start, term)
lesson_days        (id, lesson_week_id, weekday, date,
                     is_recess, unit_day, conteudo, desenvolvimento,
                     materiais, tarefas,                        -- turmas gerais
                     ppp_presentation, ppp_practice, ppp_production,   -- só inglês
                     skill_listening, skill_writing,
                     skill_reading, skill_speaking,              -- só inglês
                     agenda_html, agenda_generated_by_ai)
calendar_events    (id, date, title, html, color, is_observation)
agendas            (id, lesson_week_id, template: 'infantil' | 'fundamental',
                     image_url, coord_message, updated_by, updated_at)
ai_jobs            (id, lesson_day_id, status, prompt, result, created_at)
audit_log          (id, actor, action, entity, entity_id, at)
```

Motivo de separar `lesson_days` em vez de manter o JSON solto (como hoje): dá para
indexar, gerar a Agenda automaticamente a partir do planejamento, consultar histórico,
e a IA lê/escreve um campo específico (`agenda_html`) em vez de reprocessar um blob.

## 3. Autenticação

- **Coordenadora** (Nayara e você): login com Google OAuth, exatamente como já
  funciona hoje — nada muda para vocês duas.
- **Professoras**: link mágico por professora+turma (token opaco de alta entropia,
  sem expiração curta — como já é hoje), sem necessidade de login. O link abre
  direto no planejamento da turma dela.

## 4. Autosave (o pedido central)

- **Debounce de digitação**: a cada alteração num campo, agenda um save em ~1.5s
  de inatividade (cancela o anterior a cada tecla).
- **Save no blur**: ao sair do campo, salva imediatamente (não espera o debounce).
- **Fila local resiliente**: toda alteração primeiro grava em `localStorage`
  (rascunho local) antes de tentar a rede. Se a internet cair ou a energia
  faltar, ao reabrir o link a professora recupera o rascunho não sincronizado
  e ele tenta reenviar sozinho.
- **Botão "Salvar" continua existindo** — força o envio imediato e dá feedback
  visual (hoje ele existe só por precaução; mantém o mesmo papel).
- **Troca de dia/semana instantânea**: os dados de todas as turmas/semanas da
  professora ficam em cache no React Query (prefetch da semana seguinte/anterior
  em background), então navegar entre dias não depende de esperar a rede —
  hoje isso é lento porque cada leitura vai até o Apps Script/Sheets.

## 5. Campos novos — professoras de inglês

Por dia da semana, além dos campos gerais, um bloco "Desenvolvimento da aula"
organizado em:

- **PPP**: Presentation / Practice / Production (3 campos ricos).
- **Skills**: Listening / Writing / Reading / Speaking (o que será cobrado em
  produção, 4 campos ricos).

Só aparece quando `is_english_teacher = true` (Carol e Bruno), preservando o
layout atual para as demais.

## 6. Coluna "Agenda" no planejamento + geração por IA

- Cada linha/dia do planejamento ganha uma coluna **Agenda**.
- Botão **"Gerar por IA"** na célula: dispara um job que pega o conteúdo do dia
  (disciplinas, conteúdo, tarefa) e chama o Codex (rodando na VM iape, modelo
  que você for instalar — deixo o nome do modelo configurável por variável de
  ambiente, então quando você instalar o Codex localmente eu aponto para o
  binário/modelo certo) pedindo o texto no estilo dos modelos que já vi
  (bullets por disciplina, tom direto para os pais).
- O resultado cai editável no campo — a professora pode reescrever livremente,
  com ou sem IA.
- Se ninguém clicar em "Gerar por IA", o campo fica em branco esperando
  preenchimento manual — nunca bloqueia o salvamento do planejamento.

## 7. Página de Agenda (documento para os pais)

- Um botão em cada planejamento semanal leva para `/agenda/:lessonWeekId`.
- A tela reconstrói **exatamente** os dois modelos observados:
  - **Infantil**: grade 2 colunas (Seg–Qui) + linha final (Sexta + box de
    imagem/recado), faixas de cor por dia, cabeçalho com os dois logos.
  - **Fundamental**: mesmo esqueleto, bullets `➢`/`⮚` por disciplina, "Atividade
    para casa" destacada, ícone/selo (ex: PAAEB) opcional no cabeçalho.
- Área reservada de **upload de imagem** dentro do próprio box de recado (sem
  sair da tela) — troca a imagem sem afetar o resto do layout.
- Formatação permitida por bloco: negrito, itálico — fonte, espaçamento e
  estrutura ficam fixos para manter o padrão visual do colégio.
- Botão **Baixar PDF** (Playwright renderiza o mesmo componente da tela) e a
  agenda continua editável depois de gerada.
- Coordenadora tem acesso a todas as agendas (todas as turmas) e pode editar
  qualquer uma.

## 8. Dashboard da coordenadora

- **Atalhos diretos** no topo/dashboard: "Ir para Planejamento" e "Ir para
  Agenda" por professora/turma — sem precisar navegar manualmente.
- **Seção de Cadastro** (CRUD completo):
  - Nome, telefone (botão que abre `wa.me/<telefone>` direto), foto (upload),
    turmas (multi-seleção), ativar/desativar, editar, excluir.
  - Marcação "Professora de inglês" (liga os campos de PPP/Skills).
- Lista de professoras com busca/filtro por turma.

## 9. Migração de dados

Script único (Node, usando a Google Sheets API com uma service account, ou
lido via `clasp`/planilha) que:
1. Lê `Teachers` e `CalendarEvents` da planilha de controle
   (`1AnW4Hb4MFcN8k27ZXiB_9mzjzwHd_MdBPH8S-1VpASI`).
2. Para cada professora, abre a spreadsheet dela e importa todas as linhas de
   `Lessons` (JSON) para `lesson_weeks` + `lesson_days`.
3. Roda em modo dry-run primeiro (relatório do que seria importado) antes de
   gravar no Postgres de produção.

## 10. Desligamento do sistema antigo

- O repositório `planejamento` (Apps Script) fica arquivado como backup — não
  é apagado.
- Em `index.html`, `admin.html` e `view.html` do repo antigo, troco o conteúdo
  por uma tela de redirecionamento: link direto para
  `https://planejamento.iape.tech` + aviso claro pedindo para salvar o novo
  endereço, para não depender mais do link antigo. Isso só acontece depois que
  os dados estiverem migrados e o novo sistema validado.

## 11. Pontos em aberto que preciso confirmar com você

1. **A VM `iape` (10.41.25.10) tem IP público ou algum túnel/proxy (Cloudflare
   Tunnel, port-forward no roteador) para o DNS `planejamento.iape.tech`
   conseguir alcançá-la de fora da rede do colégio?** Isso muda a estratégia
   de deploy — sem isso, preciso de outra forma de expor o serviço publicamente.
2. Quem administra o DNS de `iape.tech` hoje (Cloudflare, Registro.br, etc.) e
   você tem acesso ao painel?
3. Confirma que o Codex na VM ainda não está instalado — nesse caso, a
   integração de IA (item 6) fica com a chamada já pronta, mas ligo de fato
   quando você instalar e me passar como invocar (CLI local, endpoint HTTP, etc.).

Se estiver de acordo com o desenho acima, o próximo passo é eu montar o schema
Prisma + a API (Fase 3), sem mexer em produção ainda.
