# Relatório de erro e mapa do sistema — planejamento IAPE (22/09/2026)

Handoff para quem for vasculhar o sistema inteiro. Contém os identificadores, os
caminhos, o que já foi corrigido, e — o que interessa — **as lacunas abertas**,
com como reproduzir cada uma.

Contexto de origem: em 18/09/2026 descobriu-se que semanas inteiras de
planejamento estavam sendo apagadas. A causa e o alcance estão em
[`POSTMORTEM_2026-09-18_planejamento_apagado.md`](POSTMORTEM_2026-09-18_planejamento_apagado.md).
Este documento é o que ficou **depois** daquela correção.

---

## 1. Identificadores

| O quê | Valor |
|---|---|
| **Apps Script ID** | `18sfeb7VW7WKl3hB7a6m4Ie3Zf1727PrhPVND6Zndo0ASwoTFfym6nhpu` |
| **Implantação em produção** | `AKfycbwKhONeOMgPsqNVT48BhjDhwouS5OCAgIUCqOSH-PTA1vElcFitcA9mcwZa8m-gg4vHtQ` — hoje na **v12** |
| **URL `/exec`** | `https://script.google.com/macros/s/AKfycbwKhONeOMgPsqNVT48BhjDhwouS5OCAgIUCqOSH-PTA1vElcFitcA9mcwZa8m-gg4vHtQ/exec` |
| **Front-end em produção** | `https://iapetec.github.io/planejamento/` (GitHub Pages, branch `main`, raiz) |
| **Repositório** | `iapeTEC/planejamento` — **público** |
| **Planilha de controle** | `1AnW4Hb4MFcN8k27ZXiB_9mzjzwHd_MdBPH8S-1VpASI` (abas `Teachers`, `CalendarEvents`) |
| **Planilha por professora** | uma cada; o id fica na coluna `spreadsheetId` da aba `Teachers` |
| **OAuth Web Client** | `433057640119-o2trlpqs7lac8kt2lbseitnm372em89b.apps.googleusercontent.com` |
| **Admins** | `nayarapatricialima@gmail.com`, `normafederal@gmail.com` |

> Há 11 implantações no projeto. **Só a `AKfycbwKhO…` importa** — é a que está no
> `platform-config.js`. Criar implantação nova gera URL nova e quebra o link de
> todas as professoras.

---

## 2. Onde está cada coisa

### 2.1 Repositório `iape-planejamento` (o que está no ar)

```
C:\Users\dell2\Documents\dev\iape-planejamento\
├── index.html  view.html  admin.html      ← telas do sistema ANTIGO, em produção
├── app.js                                 ← editor da professora (o coração do problema)
├── admin.js                               ← painel da coordenação
├── styles.css  platform-config.js         ← config pública: gasUrl, clientId, admins
└── migration\
    ├── POSTMORTEM_2026-09-18_planejamento_apagado.md   ← causa raiz e alcance
    ├── NEXT_STEPS.md                      ← histórico do projeto, status por data
    ├── ARCHITECTURE.md                    ← modelo de dados e templates de agenda
    ├── backend_live_2026-09-02.gs         ← o que rodava ANTES da correção
    ├── backend_fixed_2026-09-18.gs        ← o que roda HOJE (espelho do Código.js)
    ├── teste_guardas.js                   ← node migration/teste_guardas.js
    └── teste_import.js                    ← node migration/teste_import.js
```

### 2.2 Apps Script (backend), via `clasp`

```
C:\Users\dell2\Documents\dev\iape-planejamento-appsscript\
├── .clasp.json        ← já contém o scriptId
├── Código.js          ← backend em produção
├── Export.js          ← exportAllData(), só-leitura, gerou o snapshot de 03/09
└── appsscript.json    ← timeZone, V8, webapp: USER_DEPLOYING / ANYONE_ANONYMOUS
```

Credencial em `~/.clasprc.json`. **Fluxo seguro de publicação:**

```bash
cd Documents/dev/iape-planejamento-appsscript
clasp pull                 # SEMPRE: baixa o que está no ar e confere antes
diff Código.js ../iape-planejamento/migration/backend_fixed_2026-09-18.gs
clasp push --force
clasp deploy -i AKfycbwKhONeOMgPsqNVT48BhjDhwouS5OCAgIUCqOSH-PTA1vElcFitcA9mcwZa8m-gg4vHtQ \
             -d "descrição da mudança"
```

### 2.3 Snapshot de recuperação (repo privado, separado)

```
C:\Users\dell2\Documents\dev\planejamento-migration-private\source-export-2026-09-03.json
```

Retrato completo de 03/09: 11 professoras, 125 semanas, 1.778.332 caracteres.
**Foi o que permitiu recuperar os planejamentos apagados. Não apagar.**

### 2.4 Sistema NOVO — existe, está no ar, e ninguém usa

`planejamento.iape.tech` → React + Express + Postgres, na VM da escola.

```
iape-planejamento\app\{api,web,deploy-vm}
ssh escola-vm      # containers planejamento-{api,web,db}-1
ssh vps-siyum      # Caddy + relay + Postgres antigo (backup de 03/09, ainda de pé)
```

Nenhuma professora acessa desde **07/09/2026** — o log do nginx só tem
healthcheck e bots. Os dados lá são o retrato da importação de 03/09.
**Consequência: bug relatado por professora = investigar o sistema ANTIGO.**

---

## 3. Lacunas abertas

Ordenadas por gravidade.

### 3.1 O endpoint do Apps Script é instável — esta é a doença

Tudo que foi corrigido até aqui trata sintoma. Medição de 22/09, mesma chamada
repetida com 5s de intervalo:

```
r1 Raquel  11,2s OK      r2 Raquel  18,2s OK
r1 Josi    40,4s OK      r2 Josi     3,2s OK
r1 Carol    2,9s OK      r2 Carol   39,8s FALHOU (HTTPError)
```

Sem relação com o tamanho do conteúdo, com a professora, nem com cabeçalhos
(testei `User-Agent`, `Referer` e os três `Sec-Fetch-*` isoladamente — todos
passam). Também já vi a `/exec` devolver **página HTML do Google** e **404** em
vez de JSON.

**Reproduzir:**
```bash
for i in 1 2 3 4 5; do
  /usr/bin/time -f "%e s" curl -s -o /dev/null \
    "https://script.google.com/macros/s/AKfycbwKhONeOMgPsqNVT48BhjDhwouS5OCAgIUCqOSH-PTA1vElcFitcA9mcwZa8m-gg4vHtQ/exec?action=get&teacherId=prof-txf2grnxgpyxtr&key=2026-09-14_infantil_4"
  sleep 5
done
```

É isso que a professora vê como "NÃO SALVOU" e "Não consegui carregar esta
semana". **Não sei se é cota, throttling ou peso do script — não deu para
determinar** (ver 3.2).

Duas coisas que já foram descartadas, para não se perder tempo:

- **Não é o tamanho do conteúdo.** A maior semana do sistema (Carol, 45.462
  chars) respondeu em 2,9s enquanto a menor (Raquel, 1.975) estourou 40s.
- **Não é peso da consulta.** Em 22/09 o backend foi para a v12, que parou de
  puxar a coluna `json` inteira a cada leitura e gravação. Medido logo depois:
  25,2s / 31,5s / 3,7s — igualmente errático. A economia vale, mas não era a causa.

### 3.1.1 O `/exec` responde erro TENDO gravado — falso negativo

O achado mais concreto, e o que explica a queixa da professora.

Reproduzido em 22/09 **fora do navegador**, de um script Python simples, sem
cabeçalho nenhum: uma gravação respondeu

```json
{"ok": false, "error": "Ação desconhecida."}
```

e a leitura seguinte mostrou **o conteúdo gravado**. Ou seja: o POST executou,
gravou, e a resposta veio como erro.

A explicação que bate com os sintomas é o redirect do `/exec` sendo reentrado
como **GET sem parâmetros**, caindo no `doGet` — que lança exatamente essa
mensagem para ação desconhecida. **Não consegui provar esse caminho**, e sem os
logs de execução (3.2) não dá para ir além.

Mitigado no cliente: antes de mostrar "NÃO SALVOU", o `app.js` lê a semana de
volta e compara as linhas; se o servidor tem o que foi escrito, considera
salvo. **É contorno, não conserto** — vale investigar por que a resposta vem
errada.

**Reproduzir** (grava uma marca e restaura; use uma semana de teste):
```bash
curl -s -X POST --data-urlencode "action=save"   --data-urlencode 'data={"key":"...","teacherId":"...","payload":{...}}'   "https://script.google.com/macros/s/AKfycbwKhO.../exec"
# repetir algumas vezes: parte das respostas volta "Ação desconhecida."
# mesmo com a gravação tendo acontecido
```

### 3.2 Não há como ver os logs de execução do Apps Script

O projeto não tem projeto GCP associado, então `clasp logs` responde
`GCP project ID is not set, unable to continue`. Sem isso é impossível saber
qual função rodou, quanto tempo levou, ou qual exceção foi lançada do lado do
Google. **Investigar 3.1 a sério depende de resolver isto primeiro.**

### 3.3 Leitura sem autenticação nenhuma

`doGet` com `action=get`, `getTeacher` e `listCalendar` **não verificam nada**.
Qualquer pessoa com o `teacherId` lê o planejamento inteiro daquela professora;
`getTeacher` ainda devolve nome, turmas e o `spreadsheetId` dela.

```bash
curl "…/exec?action=getTeacher&teacherId=prof-txf2grnxgpyxtr"
```

Foi assim que auditei as 139 semanas — **sem nenhuma credencial**. Só `doPost`
com as ações administrativas valida token; `save` também não valida.

### 3.4 Gravação substitui o documento inteiro

`saveLesson_` troca o JSON completo da chave. Não há merge por campo, então uma
gravação ruim não estraga um campo — destrói a semana. Foi o que deu o raio de
explosão máximo ao bug de 18/09.

### 3.5 `LessonsHistory` cresce sem limite e nunca foi medida

A correção de 18/09 passou a arquivar a versão anterior a **cada** gravação.
Com autosave disparando no `blur`, isso pode ter virado milhares de linhas de
dezenas de KB em 4 dias, em cada planilha. **Nunca medi.** Suspeito de
contribuir para 3.1. Precisa de limite, poda, ou arquivar só quando muda.

### 3.6 Sem auditoria

Nada registra quem gravou o quê e quando, além do `updatedBy`/`updatedAt` da
última gravação. O sistema novo chegou a definir um modelo `AuditLog` no Prisma
— **nunca foi ligado, a tabela tem 0 linhas**.

### 3.7 Cache-busting manual

`index.html`, `view.html` e `admin.html` referenciam `app.js?v=<data>`. **Essa
string precisa ser trocada à mão a cada publicação.** Se esquecer, o navegador
serve o arquivo velho e a correção não chega — aconteceu em 18/09, durante o
próprio teste. Hoje está em `?v=2026-09-22a`.

### 3.8 Chaves malformadas e duplicadas na base

- Carol tem `2026-09-14_2026-06-01_3_ano` e `1_2026-06-01_2_ano` — o nome da
  turma foi poluído com uma data. Vazias, mas indicam bug de geração de chave.
- Juliana tem `2026-06-22_5_ano` **duplicada** (30 linhas e 5 linhas). Veio de
  gravação concorrente sem lock. A leitura pegava a primeira linha, então o
  conteúdo real podia ficar invisível para sempre. Mitigado (passa a ler a mais
  recente), **mas as linhas sujas continuam lá**.

### 3.9 Possível perda anterior, não recuperável

Duas semanas em branco com data de gravação muito posterior à própria semana:

| Professora | Semana | Gravada em branco em |
|---|---|---|
| Raquel | 15/06 – Infantil 4 | 04/08/2026 |
| Nataniele | 15/06 – Infantil 3 | 31/08/2026 |

**É inferência, não prova** — uma semana salva vazia pode ser inocente. Ambas já
estavam vazias no snapshot de 03/09, então só o histórico de versões do Google
Sheets teria o conteúdo.

### 3.10 Repositório público com identificadores internos

`iapeTEC/planejamento` é público e contém os IDs das planilhas em
`migration/backend_*.gs`, além do `platform-config.js` (que é público por
natureza). O ID sozinho não dá acesso, mas combinado com 3.3 o conjunto merece
revisão.

### 3.11 Decisão pendente: migrar ou manter

O sistema novo não tem nenhum desses problemas — Postgres (sem teto de célula),
sem JSONP, autosave com rascunho local, token por professora. Está pronto e
ocioso. Manter o Apps Script é dívida consciente.

---

## 4. O que já foi corrigido (para não refazer)

**Front-end** (`app.js`, no ar): trava que impede gravar semana não lida do
servidor · timeout de 10s + 3 tentativas no JSONP · faixa "Carregando…" desde o
primeiro milissegundo · rascunho local em `localStorage` a cada pausa ·
indicador honesto de gravação (antes dizia "Salvo." sem ler resposta) ·
confirmação antes de esvaziar semana com conteúdo · **Exportar/Importar** em
arquivo · não regrava quando nada mudou · 3 tentativas no save.

**Backend** (Apps Script v11): `LockService` · aba `LessonsHistory` ·
recusa de payload vazio sobre conteúdo · leitura pela linha mais recente ·
**gzip+base64 na célula** (a maior semana estava em 49.664 de 50.000 caracteres
— 99,3% do teto; caiu para ~14.800).

**Recuperado:** 50 aulas / 19.496 caracteres — Soraia (03/08 e 10/08), Raquel
(14/09), Carol (03/08 2º Ano).

**Testes:** `node migration/teste_guardas.js` e `node migration/teste_import.js`.

---

## 5. Aviso ao próximo

1. **Sempre `clasp pull` e conferir antes de `clasp push`.** O `Código.js` local
   pode estar velho; sobrescrever sem olhar reverte o que estiver no ar.
2. **Redeployar a implantação existente pelo `-i`**, nunca criar nova.
3. **Trocar o `?v=`** a cada publicação do front.
4. **Testar no navegador de verdade.** Todo o diagnóstico feito por análise de
   código e comparação de dados estava certo — mas a causa real do gatilho e o
   problema de cache só apareceram ao abrir o link da professora num Chrome.
5. Este repositório tem um **hook de auto-commit** que captura as edições
   sozinho; as mudanças caem em commits `auto-commit: <data>`.
