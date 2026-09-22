# Correcoes e verificacao do relatorio de 22/09/2026

Estas alteracoes corrigem o sistema legado (raiz do repositorio e Apps Script).
O sistema React/Postgres em `app/` nao foi migrado nem alterado.
**Este documento nao atesta uma publicacao em producao.**

## Evidencias

- Base Git: `41ecc4b`; copia original e sua alteracao local preservadas.
- Uma copia nova do Apps Script foi baixada via `clasp clone`. Ela coincide com
  a otimizacao local de leitura seletiva de colunas. A implantacao real ja era
  **versao 12**, nao a 11 mencionada no relatorio de origem.
- Tres leituras identicas, sequenciais, com `curl -L --max-time 45`:
  HTTP 200 em 21,981 s; HTTP 200 em 4,323 s; HTTP 404 em 9,245 s.
  As duas respostas boas tinham o mesmo tamanho. Os corpos foram guardados
  apenas na pasta privada de auditoria, fora do Git.
- A Sheets API recusou a credencial do clasp porque a API nao esta habilitada
  no projeto OAuth desse cliente. A consulta de execucoes do Apps Script recusou
  por escopo insuficiente. Exportacao via Drive e `clasp run exportAllData`
  tambem recusaram acesso. Nenhuma permissao foi contornada.
- Nao foi possivel medir o historico atual nem consultar o historico de versoes
  do Sheets com essas credenciais. O snapshot privado de 03/09 foi preservado.

## Tratamento Por Item

| Item original | Alteracao / resultado | Limite restante |
| --- | --- | --- |
| 3.1 Instabilidade | Leitura com prazo de 45 s; POST com abort/limite; fila de saves; respostas tardias ignoradas; revisao/idempotencia protegem retentativas. Otimizacao v12 preservada. | O 404 do Google foi reproduzido. Causa externa ainda nao determinada; nao ha promessa de estabilidade do provedor. |
| 3.2 Logs | Logs estruturados de acao, duracao e erro, sem payload/token; endpoint `diagnostics` restrito a admin. | Consulta aos logs atuais requer os escopos Google corretos; logs detalhados usam o projeto Cloud associado. |
| 3.3 Acesso aberto | Leitura/escrita exigem token privado por professora ou Google admin; permissao de leitura separada. Perfil nao expoe `spreadsheetId`. | Ativacao requer novos links; os antigos nao sao credenciais validas. |
| 3.4 Sobrescrita integral | Comparacao atomica de revisao sob lock. Conteudo desatualizado e recusado; resposta perdida pode ser repetida sem duplicar historico. | A unidade continua sendo a semana. Nao faz merge automatico de campos; em conflito, recarregar e conferir o rascunho. |
| 3.5 Historico | Nao arquiva conteudo identico, inclusive JSON antigo versus gzip. Aba ativa rotacionada apos 500 versoes; nenhuma versao apagada. | Rotacao limita a aba ativa, nao o total de celulas da planilha. Retencao destrutiva ou arquivo externo exige politica propria. |
| 3.6 Auditoria | `AuditLog` registra ator autenticado, acao, chave, horario e revisoes; historico preserva conteudo anterior. | Nao recria auditoria passada e nao altera o sistema novo. |
| 3.7 Cache | Build cria nomes com SHA-256 do conteudo; workflow testa, gera e publica apenas os arquivos do site. | Pages precisa usar GitHub Actions antes da ativacao. |
| 3.8 Chaves/duplicatas | Validacao de data real/segunda-feira, turma autorizada e identidade do payload. Leitura usa a linha mais recente. Diagnostico lista chaves invalidas/duplicadas. | Linhas existentes nao foram excluidas ou fundidas sem inspecao/backup; podem conter versoes diferentes. |
| 3.9 Perda antiga | Nenhuma restauracao especulativa. Snapshot intacto. | So o historico do Google pode confirmar/recuperar essas duas semanas. |
| 3.10 Identificadores publicos | IDs deixam de autorizar acesso; resposta de perfil remove ID de planilha; pacote Pages inclui somente assets publicos. | O repositorio e seu historico continuam publicos; IDs antigos nao foram apagados do Git. |
| 3.11 Migracao | Mantido o sistema em uso, conforme direcao assumida enquanto nao ha decisao de corte. | Migrar exige snapshot atual e reconciliacao com os dados novos das professoras. |

## Outras Falhas Corrigidas

- Uma leitura antiga nao aplica dados nem status sobre outra semana/turma.
- Saves usam snapshots imutaveis, em fila, com revisao da leitura correspondente.
- Confirmacao atrasada nao apaga rascunho mais recente ou de outra semana.
- Trocar semana/turma preserva rascunho antes de limpar a tela.
- Desfazer uma edicao durante save enfileira a volta ao conteudo original.
- Navegar sem editar nao sobrescreve um rascunho ainda nao recuperado; alteracoes
  apenas no recado ou na data tambem entram na comparacao do rascunho.
- Modo leitura nao envia save; servidor tambem impede escrita com token de leitura.
- Payload lido/importado nao redefine professora/turma da tela.
- Arquivo importado exige chave e e conferido novamente ao aplicar.
- Painel administrativo aguarda JSON `ok:true`; timeout/recusa nao vira sucesso.
- Callback JSONP e validado; parametro `gas` nao pode desviar credenciais.
- Erros internos nao devolvem nem registram mensagens brutas com tokens/URLs.
- Consultas nao criam abas ausentes; verificacao Google rejeita token expirado.
- Harness dos testes funciona com CRLF e usa os arquivos da copia em teste.

## Verificacao Local

```powershell
npm test
npm run build
git diff --check
```

Os testes exercitam as funcoes reais de `app.js`, `admin.js` e do Apps Script,
simulando apenas DOM, rede e servicos Google. Incluem corridas, autenticacao,
conflitos, idempotencia, rotacao, importacao e integridade dos assets publicados.
O snapshot privado e opcional no CI. Nesta maquina, o teste de compressao tambem
foi executado sobre as 125 semanas do snapshot, sem diferencas no round-trip.
Resultado final local: **34 testes passando**, build e verificacao de diff sem
erros. Uma revisao independente apontou tres falhas importantes; as tres foram
reproduzidas, corrigidas e cobertas por regressao antes deste resultado.

Nao houve interacao com navegador/interface grafica, conforme a preferencia do
usuario. Falta a verificacao visual dos fluxos com links novos antes do corte.

## Ativacao Coordenada

1. Conferir a versao remota e baixar novamente o Apps Script em uma pasta nova;
   comparar para nao sobrescrever alteracoes feitas depois desta auditoria.
2. Fazer backup atual das planilhas usando uma credencial com leitura autorizada.
   O diagnostico novo e somente leitura e identifica os registros a revisar.
3. Substituir apenas `Codigo.js` pelo backend corrigido, preservando `Export.js`
   e manifest; publicar uma nova versao na **mesma implantacao existente**.
4. Ativar a origem GitHub Actions do Pages e publicar o frontend desta branch.
   Backend e frontend formam um contrato: `getVersioned` devolve
   `{lesson, revision}` e `save` exige `baseRevision`, devolvendo `payload.revision`.
5. A coordenacao entra com Google. `adminList` cria, sob lock, o segredo
   `LESSON_ACCESS_SECRET` nas Script Properties caso ainda nao exista, e emite os
   links individuais autenticados. Copiar esses links pelo painel.
6. Distribuir os novos links por canal privado. Tokens vao no fragmento `#access=`
   do link. Compartilhamento do planejamento gera token separado de leitura.
7. Verificar `?action=health`, negativa de GET/POST anonimos e fluxos autenticados
   de leitura, save, reabertura e conflito usando uma professora de teste.

O corte precisa ser combinado: os links antigos usam apenas um identificador
publico, portanto nao podem continuar autorizando leitura/escrita. O segredo
permanece somente no Google; nunca deve ser incluido em codigo, issue ou PR.
Rollback de codigo pode reabrir o acesso anonimo: restaurar a versao antiga
exige considerar esse efeito, alem dos rascunhos ainda nao sincronizados.

## Referencias

- [Execucoes pela API do Apps Script](https://developers.google.com/apps-script/api/reference/rest/v1/processes/listScriptProcesses)
- [GitHub Pages com workflow proprio](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
