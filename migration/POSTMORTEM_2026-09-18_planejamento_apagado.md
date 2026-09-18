# Post-mortem — planejamentos apagados no sistema antigo (18/09/2026)

Investigado em 18/09/2026, a partir do relato de que "o planejamento da Raquel
desapareceu". Correção no commit `2ab4a18`. O estado "antes" citado aqui é o do
commit pai, `72b7c7f`.

---

## 1. O que aconteceu

Semanas inteiras de planejamento foram **substituídas pelo template em branco**
na planilha da professora. Não foram esvaziadas campo a campo: a semana inteira
foi trocada por uma recém-gerada.

A assinatura é inconfundível. A semana de 14/09 da Raquel, antes e depois:

| Dia / slot | Antes | Depois |
|---|---|---|
| SEG slot 0 | `BÍLINGUE` | `BÍLINGUE` |
| SEG slot 1 | `EF` | *(vazio)* |
| SEG slot 2 | `PRI.V` | *(vazio)* |
| SEG slot 3 | `EO` | *(vazio)* |
| TER slot 1 | `CAPELA` | *(vazio)* |
| TER slot 3 | `TS` + a aula "MEU MONSTRINHO DA RAIVA" (1.975 chars) | *(vazio)* |
| QUA/QUI/SEX slot 0 | *(vazio)* | `BÍLINGUE` |

As disciplinas que a professora tinha digitado sumiram, e no lugar apareceu
`BÍLINGUE` no slot 0 de **todos** os dias — inclusive em dias que antes não
tinham nada. Isso é exatamente a saída de `buildInitialRows()`. Ou seja: o que
foi gravado por cima não era "a semana dela vazia", era **uma semana nova**.

### Alcance

Auditei as 139 semanas das 11 professoras, comparando o estado ao vivo com o
snapshot `planejamento-migration-private/source-export-2026-09-03.json`.

| Professora | Semana | Perdido | Restaurado |
|---|---|---|---|
| Soraia | 03/08 – 3º Ano | 22 aulas / 11.195 chars | ✅ |
| Soraia | 10/08 – 3º Ano | 26 aulas / 6.079 chars | ✅ |
| Raquel | 14/09 – Infantil 4 | 1 aula / 1.975 chars | ✅ |
| Carol | 03/08 – 2º Ano | 1 aula / 247 chars | ✅ |

Total: 50 aulas, 19.496 caracteres — cerca de **1,1%** dos 1.778.332 caracteres
de planejamento que existiam em 03/09. Todo o resto estava íntegro.

---

## 2. Qual era o erro

Três pedaços de código que, isolados, parecem razoáveis.

**a) A tela era limpa antes de saber o que havia no servidor.** Em `setClass()`
e `setWeek()`, o fluxo era:

```js
state.rows = buildInitialRows(state.weekStart);  // template em branco
hydrateUI();                                      // pinta o branco na tela
await loadFromBackend();                          // só AGORA pergunta ao servidor
```

O comentário original no código explica a intenção: *"✅ MUITO IMPORTANTE: ao
trocar de turma, já limpa tudo IMEDIATAMENTE pra lançar"*. É uma decisão de
usabilidade — a troca de semana fica instantânea em vez de esperar a rede.

**b) A falha de leitura era silenciosa.** `loadFromBackend()` era `await`-ado
**sem `try/catch`** nos três pontos que o chamavam (`setClass`, `setWeek`,
`init`). Se a chamada falhasse, a promise rejeitava, ninguém tratava, e o
template em branco do passo (a) simplesmente **continuava na tela** — sem erro
visível, sem aviso, indistinguível de uma semana que ainda não foi preenchida.

**c) Qualquer `blur` gravava a semana inteira.** Todos os campos editáveis
tinham `el.addEventListener("blur", () => saveToBackend({ silent: true }))`, sem
nenhuma checagem de "mudou alguma coisa?". E `saveToBackend` envia o payload
**inteiro** (`buildLessonPayload()` → `state.rows` completo).

Juntando: load falha → tela em branco sem aviso → professora clica num campo e
sai dele → grava o branco por cima → `saveLesson_` sobrescreve o JSON inteiro
daquela chave. **Ela não precisou nem digitar nada.** Um clique e um clique fora
bastavam.

---

## 3. Por que aconteceu

O erro de código é o item 2. As razões de fundo são outras.

### 3.1 O estado não distinguia "não sei" de "está vazio"

Essa é a causa raiz. `state.rows` tinha dois significados possíveis — *"o que o
servidor tem"* e *"um rascunho em branco enquanto espero"* — e **nada no
programa dizia qual dos dois valia naquele instante**. O autosave lia essa
variável e gravava, sem ter como perguntar "isso aqui é dado real?".

É por isso que a correção é pequena e mesmo assim resolve: `state.loadedKey` só
é preenchido quando a leitura **termina**, e `saveToBackend` recusa gravar
enquanto `loadedKey` não bater com `makeKey()`. Passou a existir um estado
explícito para "ainda não sei o que tem lá".

Repare que "semana que ainda não existe" **continua** podendo ser gravada: o
servidor respondeu, respondeu `null`, isso é sucesso. O que não pode é *falha*
virar *branco salvável*.

### 3.2 Gravação era substituição total, não edição de campo

`saveLesson_` troca o JSON inteiro da chave:

```js
sheet.getRange(i + 1, 2, 1, 3).setValues([[json, now, teacherId]]);
```

Não há merge por campo. Logo, **uma** gravação ruim não estraga um campo —
destrói a semana toda. O raio de explosão de qualquer bug de escrita era máximo
por construção.

### 3.3 Não havia rede de proteção em lugar nenhum

- **Sem histórico**: a aba `Lessons` tem 4 colunas (`key`, `json`, `updatedAt`,
  `updatedBy`). A versão anterior era descartada. A recuperação só foi possível
  porque existia, por acaso, um snapshot da migração de 03/09.
- **Sem lock**: `saveLesson_` não usava `LockService`. Duas gravações
  simultâneas liam a mesma tabela e as duas caíam no `appendRow`, criando linhas
  duplicadas com a mesma chave — aconteceu com a Juliana em `2026-06-22_5_ano`.
  E como a leitura pegava a **primeira** linha encontrada, o conteúdo real podia
  ficar invisível para sempre.
- **Sem auditoria**: nada registra quem gravou o quê e quando. (O sistema novo
  chegou a definir um modelo `AuditLog` no Prisma, mas ele nunca foi ligado —
  a tabela está com 0 linhas.)

### 3.4 O gatilho não é determinável, e isso é parte do problema

Alguma coisa precisa fazer a leitura falhar. `apiGet` usa **JSONP** — injeta uma
`<script>` e espera o callback. Esse mecanismo:

- não tem timeout: se o callback nunca vem, a promise fica pendurada para sempre;
- não tem detalhe de erro: `script.onerror` dispara igual para queda de wifi,
  throttling do Apps Script, ou um redirect de login — e a mensagem é sempre a
  mesma string genérica.

Candidatos plausíveis: rede da escola, cota/latência do Apps Script, aba
suspensa no celular. **Não dá para saber qual foi** — e essa é justamente a
consequência de (3.3): não há log de nada. A investigação só chegou ao culpado
por comparação forense com o snapshot, não por observação.

### 3.5 Por que ninguém percebeu antes

A perda é silenciosa e tardia. Quem apaga é a própria professora, sem saber, e
só descobre quando volta naquela semana — dias ou semanas depois. Nada na tela
muda no momento do acidente. A coordenação olha as semanas correntes, não as
passadas. Das 4 semanas atingidas, 3 eram de agosto.

---

## 4. Indício de que isso já vinha acontecendo antes

O bug **não** é novo. Procurei no snapshot de 03/09 semanas com estrutura
completa, conteúdo zero e data de gravação real — e duas chamam atenção por
terem sido gravadas em branco **muito depois** da própria semana:

| Professora | Semana | Gravada em branco em |
|---|---|---|
| Raquel | 15/06 – Infantil 4 | 04/08/2026 (7 semanas depois) |
| Nataniele | 15/06 – Infantil 3 | 31/08/2026 (11 semanas depois) |

Ninguém abre uma semana de junho no fim de agosto para deixá-la vazia. O padrão
bate com o mesmo mecanismo.

Ressalva importante: **isso é inferência, não prova.** Uma semana salva vazia
pode ser perfeitamente inocente — a professora abriu, olhou e saiu. Só listo as
duas em que a distância entre a semana e a data de gravação torna a explicação
inocente pouco plausível. E elas **não são recuperáveis pelo snapshot**, porque
já estavam em branco nele. Só o histórico de versões do Google Sheets teria.

Também suspeito (mais fraco): Soraia, semanas de 08/06 e 22/06, ambas gravadas
em branco em 25/06 com **21 segundos** de diferença — o intervalo típico de
navegar de uma semana para a seguinte.

---

## 5. O que foi corrigido

Commit `2ab4a18`.

| Arquivo | Correção |
|---|---|
| `app.js` | `state.loadedKey` — nenhuma gravação sai sem a semana ter sido lida do servidor. `loadWeekIntoState()` embrulha o load com `try/catch`. Falha agora mostra uma faixa vermelha fixa no topo com botão "Tentar de novo", em vez de fingir que está tudo bem. |
| `migration/backend_fixed_2026-09-18.gs` | `LockService`; aba `LessonsHistory` guardando a versão anterior de **toda** sobrescrita; recusa de payload vazio por cima de conteúdo; leitura pela linha mais recente quando há chave duplicada (desenterra o caso da Juliana). |
| `app/web/src/pages/TeacherPlanner.tsx` | O sistema novo tinha a **mesma falha latente**: se o `weekQuery` falhasse, a tela ficava no `emptyDays` e a primeira tecla disparava um `PUT` que zerava os dias. Autosave passou a depender de `canSave()`. |

### Pendente

**Colar `backend_fixed_2026-09-18.gs` no Apps Script e republicar como *nova
versão* da implantação.** Sem republicar, a URL `/exec` continua servindo o
código antigo. Enquanto isso não acontece, a proteção existe só no front-end —
que é onde o bug estava, mas é uma camada só.

### Mudança de comportamento a conhecer

A recusa de gravação vazia impede uma professora de **limpar uma semana inteira
de propósito**. O trade-off foi considerado aceitável (é uma ação rara, e o
`LessonsHistory` torna qualquer engano reversível), mas é uma mudança real.

---

## 6. O que fazer diferente

1. **Estado de carregamento explícito.** Qualquer tela que edite algo remoto
   precisa distinguir *carregando* / *carregado* / *falhou*, e bloquear escrita
   nos dois primeiros. Foi o que faltou aqui.
2. **Falha de rede tem que aparecer.** Um `catch` que só faz `console.warn` é
   equivalente a não ter `catch` nenhum, do ponto de vista de quem está usando.
3. **Histórico antes de sobrescrever.** Barato, e transforma um incidente destes
   de investigação forense em um `Ctrl+Z`.
4. **Não gravar sem mudança.** O `blur` deveria comparar com o último estado
   salvo. Gravar em toda perda de foco multiplica por muito as chances de um
   estado ruim ser persistido.
5. **Manter o snapshot de migração.** `source-export-2026-09-03.json` foi o que
   permitiu recuperar. Não apagar.
