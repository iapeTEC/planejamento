# Planejamento IAPE → SaaS escolar — Plano completo e estado atual

Este documento existe para que qualquer sessão (Claude, Codex, ou você mesma)
consiga continuar este projeto sem precisar refazer a descoberta. Escrito em
2026-09-02 depois da Fase 1 (descoberta) e Fase 2 (arquitetura). Ver também
`ARCHITECTURE.md` nesta mesma pasta (mais detalhado no desenho técnico).

## Status de acesso (atualizado 2026-09-02, fim do dia)

**Acesso à VM `iape` está funcionando** a partir do PC de casa (Windows),
via alias `ssh iape-vm-casa-tunel` (= `ssh escola-vm`), documentado em
`C:\Users\dell2\OneDrive\Documents\ACESSOS-CLAUDE-VM-VPS-DEBIAN.md`. Também
funciona o acesso à Debian de casa via `ssh debian-casa-local`.

Histórico do problema (só como referência, já resolvido): a rota passa por
PC de casa → VPS `siyum` (78.111.90.91, porta 22) → túnel reverso →
VM/Debian. Em algum momento a porta 22 da VPS estava recusando conexão
(confirmado via teste TCP puro, de duas máquinas diferentes) — não era
problema de chave/config local, era a própria VPS. O usuário liberou a porta
do lado de lá e passou a funcionar. Se isso voltar a acontecer, o sintoma é
`Connection timed out`/`refused` para `78.111.90.91:22` mesmo com tudo
configurado certo — não adianta insistir por aqui, precisa checar a VPS.

Qual alias usar depende de onde o computador está fisicamente — ver a tabela
no início do `ACESSOS-CLAUDE-VM-VPS-DEBIAN.md`.

## O que já foi feito (Fase 1 — Descoberta)

- Confirmado acesso `gh` como conta `iapeTEC`, repositório
  `iapeTEC/planejamento` (público).
- Clonado o projeto Apps Script **real e ao vivo** via `clasp` (não o que
  estava desatualizado/apagado do git) — script ID informado pelo usuário.
  Código salvo aqui em `backend_live_2026-09-02.gs`.
- Recuperado do histórico do git o `backend.gs` antigo (apagado em
  01/06/2026), salvo em `backend_recovered_pre_deletion.gs` — útil só como
  referência histórica, o arquivo `backend_live_2026-09-02.gs` é o que
  realmente está rodando em produção hoje.
- Inventariada a planilha de controle (Teachers + CalendarEvents) — 11
  professoras cadastradas, com dados reais desde 28/05/2026. Confirmado que
  os dados de planejamento (JSON por semana/turma) existem e são recuperáveis.
- **Corrigido**: turma do Bruno atualizada de "4º Ano" para "4º Ano, 6º Ano"
  diretamente na planilha de controle (ele dá aula pros dois).
- Lidos e entendidos os dois modelos de Agenda semanal (Infantil e
  Fundamental) em `C:\Users\dell2\OneDrive\Documents\` — estrutura descrita
  em detalhe na seção 7 do `ARCHITECTURE.md`.
- Identificado que os campos de PPP (Presentation/Practice/Production) e as
  habilidades Listening/Writing/Reading/Speaking **não existem** no sistema
  atual — são features novas mesmo.
- Confirmado que login com Gmail (Google OAuth) já é o método de acesso da
  coordenação (Nayara e você) — não muda no novo sistema. Professoras já
  usam link mágico sem login — também não muda, só migra de tecnologia.

## O que falta (Fase 3 em diante)

### Fase 3 — Backend local (não depende de VM nenhuma)

- Schema Prisma/Postgres conforme seção 2 do `ARCHITECTURE.md`
  (`teachers`, `classes`, `teacher_classes`, `lesson_weeks`, `lesson_days`
  com os campos novos de PPP/skills, `agendas`, `calendar_events`, `ai_jobs`,
  `audit_log`).
- API REST (Node/Express ou Fastify + TypeScript):
  - Auth coordenadora: Google OAuth (reaproveitar `GOOGLE_CLIENT_ID` já
    existente: ver `platform-config.js` no repo).
  - Auth professora: token opaco por professora+turma (link mágico), sem
    expiração curta, igual ao comportamento atual.
  - CRUD de professoras (nome, telefone, foto, turmas, ativo/inativo,
    is_english_teacher) — usado pelo dashboard de cadastro da coordenadora.
  - CRUD de planejamento semanal (`lesson_weeks`/`lesson_days`), com
    endpoint de autosave (aceitar patches parciais por campo/dia).
  - CRUD de Agenda (`agendas`), geração de PDF (Playwright) e upload de
    imagem do recado.
  - Endpoint de job de IA (`POST /lesson-days/:id/agenda/generate`) que
    enfileira e chama o Codex.
- Script de migração de dados: ler `Teachers`/`CalendarEvents` da planilha de
  controle (ID no `platform-config.js` do repo) e as abas `Lessons` de cada
  planilha de professora, transformar em linhas Postgres. Rodar em
  `--dry-run` primeiro.

### Fase 4 — Frontend (React + Vite)

- Editor de planejamento da professora: mesma UX de hoje (grid por dia,
  campos ricos, troca de turma/semana instantânea via cache/prefetch),
  + autosave por debounce/blur + fila local em `localStorage` para não
  perder nada se a internet cair (ver seção 4 do `ARCHITECTURE.md`).
- Bloco extra "Desenvolvimento da aula" só para `is_english_teacher`: PPP
  (Presentation/Practice/Production) + Skills (Listening/Writing/Reading/
  Speaking).
- Coluna "Agenda" por dia, com botão "Gerar por IA" (chama o endpoint acima)
  e campo editável manualmente.
- Botão em cada planejamento semanal → tela de Agenda (`/agenda/:id`):
  reconstrução fiel dos dois templates (Infantil/Fundamental), upload de
  imagem dentro da própria área reservada, exportar PDF, editável depois de
  gerado. Coordenadora acessa e edita qualquer agenda.
- Dashboard da coordenadora:
  - Atalhos diretos para Planejamento/Agenda por professora/turma.
  - Seção de Cadastro (CRUD completo: nome, telefone com botão WhatsApp
    `wa.me/<telefone>`, foto, turmas, ativar/desativar, editar, excluir).

### Fase 5 — IA (Codex na VM)

- Só pode ser ligada de verdade depois que você instalar o Codex na VM
  `iape` e me passar como invocar (CLI local via SSH, ou um endpoint HTTP
  que o Codex expõe). O endpoint da API já fica pronto pra isso, só falta
  o adaptador concreto.
- Nome do modelo deve ficar em variável de ambiente (ex:
  `AI_MODEL=codex-luna-medium`) para trocar sem redeploy.

### Fase 6 — Deploy na VM `iape`

Levantamento real feito em 2026-09-02 (via `ssh iape-vm-casa-tunel`, host
`srv-school`, Debian 13/trixie, Docker 29.7.2, Compose v5.5.0):

| Container | Porta (loopback) | Rede Docker |
| --- | --- | --- |
| `projeto-app` | 127.0.0.1:3000 | `projeto_projeto_internal` |
| `homework-app` | 127.0.0.1:3200 | `homework_homework_internal` |
| `onevoice27-web-1` | 127.0.0.1:3127 | `onevoice27_app_internal` |
| `onevoice27-db-1` (Postgres 17) | só interno (5432, não publicado) | `onevoice27_app_internal` |

Nenhum Nginx ativo na VM — tudo hoje só escuta em `127.0.0.1`, nada exposto
publicamente a partir dela diretamente. Disco: 101G livres de 119G. RAM: 7.8Gi
total, ~5.8Gi disponível — folga confortável pra mais um stack pequeno.

⚠️ **Importante**: o novo stack (Postgres + API + web) precisa:
- Nome de projeto Docker Compose próprio (ex: `planejamento`), rede Docker
  própria (ex: `planejamento_internal`) — **não reaproveitar rede/nome de
  container dos projetos acima**.
- Publicar a API/web numa porta loopback livre (ex: `127.0.0.1:3300` — checar
  de novo com `docker ps -a` e `ss -tlnp` antes de subir, para o caso de algo
  novo ter sido adicionado desde este levantamento).
- Postgres do novo stack não deve ser exposto para fora da rede interna dele
  (seguir o mesmo padrão do `onevoice27-db-1`, que já faz isso certo).

**DNS**: a VM não tem IP público — só é alcançável via túnel reverso pela
VPS. Duas opções:
1. Nginx na própria VPS fazendo proxy pelo túnel reverso já existente até a
   porta da app na VM.
2. Um túnel reverso dedicado (autossh/systemd) mantendo a porta da app da VM
   sempre exposta em `127.0.0.1:<porta>` na VPS, com Nginx + Certbot na VPS
   servindo `planejamento.iape.tech` e fazendo proxy pra lá.

Não documento aqui IP/porta/senha da VPS ou da VM por segurança — este
repositório é **público**. Essas credenciais já estão nos atalhos locais do
Windows (`Acesso VM iape.lnk`, `debian.lnk`) e devem ser passadas por fora do
git quando a sessão que for implantar precisar delas.

### Fase 7 — Corte final

1. Migrar os dados reais (script da Fase 3, rodado contra produção depois de
   validado em dry-run).
2. Validar com Nayara e pelo menos 2-3 professoras antes de virar de vez.
3. Apontar DNS `planejamento.iape.tech`.
4. Nas páginas antigas (`index.html`, `admin.html`, `view.html` deste mesmo
   repositório), substituir o conteúdo por uma tela de redirecionamento:
   link direto para `https://planejamento.iape.tech` + aviso pedindo pra
   salvar o novo endereço, pra não depender mais do antigo. O Apps Script
   antigo fica só como backup, não é apagado.

## Pendências que só você resolve

1. Confirmar a rede/rota certa para alcançar VM/Debian quando a implantação
   começar de verdade.
2. Instalar o Codex na VM e definir como invocá-lo (Fase 5).
3. Decidir a estratégia de exposição pública (Nginx na VPS vs. túnel
   dedicado) — depende de quanto acesso você quer dar à VPS `siyum` para
   este projeto.
