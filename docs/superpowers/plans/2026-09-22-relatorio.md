# Correcao do relatorio de 22/09

**Objetivo:** corrigir os riscos do sistema legado em uso, preservando os dados.
**Especificacao:** migration/RELATORIO_PARA_ASTRA_2026-09-22.md.
**Arquitetura:** manter Apps Script/Sheets e frontend atual; autenticar acessos,
usar revisao otimista no documento, serializar saves e rejeitar respostas antigas.
**Execucao:** nesta sessao; testes Node com servicos externos simulados.

## Tarefas

- [x] Reproduzir e corrigir corridas de leitura, save e rascunho em app.js.
  Testes: duas leituras fora de ordem; editar durante save; trocar semana durante
  save; salvar em modo leitura; timeout e erro de negocio sem retentativa.
- [x] Autenticar backend com token privado por professora ou Google admin.
  Validar turma, data, chave, callback e revisao; nao expor spreadsheetId no perfil.
  Testes: acesso anonimo/errado; leitura autorizada; conflito; repeticao idempotente;
  chave malformada; nenhuma escrita quando a revisao diverge.
- [x] Historico sem copias identicas, auditoria de ator/revisao e diagnostico restrito.
  Limitar historico ativo por rotacao, preservando arquivos antigos sem exclusao.
  Testes: JSON legado versus comprimido; rotacao; leitura sem criar abas.
- [x] Corrigir confirmacao/timeout no admin e links autenticados de leitura/escrita.
  Testes: servidor recusa POST; nao apresentar sucesso; token de leitura nao grava.
- [x] Automatizar publicacao estatica com hashes dos assets e testes no CI.
  Testes: gerar site duas vezes e conferir hashes/referencias e arquivos permitidos.
- [ ] Medir backend publicado, inventariar dados sem alterar, documentar evidencias
  e pendencias por item. Revisao independente e suite completa antes de publicar.

## Restricoes

- Nenhum dado de professora ou credencial entra no repositorio publico.
- Nao excluir linhas, historico ou snapshots. Recuperacao antiga depende de prova.
- Preservar alteracao local preexistente de leitura seletiva de colunas.
- Nao controlar navegador/interface grafica sem autorizacao especifica.
- Publicacao que exija novos links precisa explicitar o impacto antes do corte.

## Riscos De Revisao

- Resposta perdida apos commit: mesma revisao/conteudo deve retornar sucesso.
- Campos editados durante uma requisicao nao podem perder o rascunho.
- Link somente leitura nao pode virar escrita por parametro ou endpoint.
- Datas/turmas do payload nao podem alterar a identidade da semana aberta.
- Falha de observabilidade nao pode fingir sucesso nem expor tokens nos logs.

## Registro

- Baseline: teste_guardas passou; teste_import falhou em Windows porque procura
  LF em arquivo CRLF. Corrigir o harness para executar codigo desta worktree.
- Decisao: isolamento autorizado pela tarefa; copia original permanece intacta.
- Decisao: manter legado enquanto nao houver escolha de migracao; nenhuma mudanca
  de DNS, banco ou exclusao faz parte destas correcoes.
- Revisao independente: tres achados importantes, todos reproduzidos em testes e
  corrigidos: desfazer durante save; sobrescrever rascunho pendente ao navegar;
  credenciais em mensagens brutas de excecao. Suite final local: 34/34.
- Verificacao real: endpoint repetido retornou 200/200/404. Nao concluir que a
  instabilidade externa foi resolvida. Inspecao completa do historico bloqueada
  pelas permissoes das APIs Google. Detalhes em migration/CORRECOES_2026-09-22.md.
- Decisao: comparacao de revisao, sem merge automatico de campos; preserva
  concorrencia com modelo atual, mas usuario precisa conferir rascunho em conflito.
- Decisao: rotacao preserva tudo; nao limita o total da planilha nem faz limpeza
  irreversivel de dados. Manutencao dos dados antigos permanece pendente.
- Verificacao de navegador/CORS e corte de producao pendentes. Nao houve controle
  de interface grafica, envio de mensagens a professoras ou publicacao no main.
