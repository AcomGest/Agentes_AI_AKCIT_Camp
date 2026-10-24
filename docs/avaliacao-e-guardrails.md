# Avaliação e guardrails

O agente foi construído para errar de forma segura: quando não tem certeza, ele pergunta ou bloqueia, e nunca grava sozinho.

## Guardrails

| Risco | Guardrail | Onde |
| --- | --- | --- |
| Arquivo errado ou grande demais | Guarda recusa antes de chamar a IA | `inputGuard.js` |
| Modelo devolve formato errado | JSON Schema no pedido + validação no código + 1 nova tentativa com o erro; depois falha fechada | `reader.js`, `schema.js` |
| Modelo inventa uma medida | Número só entra se veio de medida escrita na tela; caso contrário vira `bloqueio` e fica fora do rascunho | `crossCheck.js`, `harness.js` |
| Exame do animal errado | Brinco da tela comparado com o animal escolhido (`bloqueio`) | `crossCheck.js` |
| Achado incoerente com o histórico | Idade gestacional contra a data do serviço; prenhe sem serviço; vazia após positivo | `crossCheck.js` |
| Narrativa com número inventado ou recomendação | Verificador recusa e usa o texto-modelo | `writer.js` |
| IA decidindo pelo veterinário | Exame com IA = Sim só é aprovado pelo perfil Veterinário (403 para os demais) | `approveResourceAction` |
| Acesso a dado de outra fazenda | Rota exige sessão da mesma fazenda (404) e permissão de ultrassom (403) | `ultrasoundAgentRoutes.js` |
| Modelo fora do ar | Tempo-limite de 60 s; status `falha_no_modelo`; nada é gravado | `gemini.js`, `harness.js` |
| Execução sem fim | Limite de 8 etapas | `harness.js` |
| Demonstração confundida com leitura real | Modo simulado marcado na API (`simulated: true`) e na tela | `simulated.js`, painel |

## Testes automatizados (executados em 24/10/2026)

| Teste | O que prova | Resultado |
| --- | --- | --- |
| `agents/ultrasound-agent/test/harness.test.js` | Guarda recusa sem chamar o modelo; caminho feliz; contrato inválido com nova tentativa e falha fechada; falha do modelo; animal divergente, idade gestacional divergente e medida sem tela bloqueiam; prenhe sem serviço e vazia após positivo; Verificador recusa número inventado e recomendação | 10 de 10 cenários passaram (v3) |
| `scripts/backend-ultrasound-agent-smoke-test.cjs` | Servidor real (SQLite): analisar não grava; sem permissão 403; outra fazenda 404; arquivo inválido 400; rascunho salvo com IA = Sim; Gerente não aprova; Veterinário aprova; exame sem IA mantém a regra antiga | 6 de 6 cenários passaram |

Os dois testes usam um modelo falso: eles provam a lógica do agente, não a qualidade da leitura do Gemini.

## Primeira execução com exame real (24/10/2026)

Um vídeo AVI de 13 MB exportado de um aparelho Mindray, rodado com o Gemini (`gemini-flash-latest`, resposta do modelo `gemini-3.8-flash`). É uma execução, não uma medida de acerto: o exame ainda não tem rótulo do veterinário.

| O que o agente fez | Resultado |
| --- | --- |
| Leu o texto da tela | Animal "faisca", data 26/09/2026, aparelho "Mindray DP-10Vet Power"; nenhuma medida na tela |
| Exame aberto para outro brinco (1042) | Bloqueou: "A tela mostra o animal faisca, mas o exame foi aberto para o brinco 1042" |
| Exame aberto para o animal certo | Rascunho sem bloqueio |
| Medidas | Descreveu estrutura ovariana/lútea visível, mas deixou o corpo lúteo vazio por não haver medida na tela (nenhum número inventado) |
| Gestação | "indeterminado", confiança 50%, com a evidência "exame focado em ovário"; gerou alerta de baixa confiança |
| Custo e tempo do Leitor | 622 tokens de entrada e 509 de saída, 16 s |

## Correção v3: fontes separadas (24/10/2026)

**Causa encontrada.** Na v2, uma única chamada recebia o vídeo inteiro mais o contexto do cadastro e fazia, ao mesmo tempo, a leitura do texto da tela, a análise visual e o preenchimento de um campo "animal". Consequências no vídeo de referência `202510221345170005OB.AVI`:

- O texto "Gabriel", na lateral da tela, virou o "animal" do exame e gerou um bloqueio falso, `animal_divergente`.
- Como não havia quadros nem instantes, não dava para conferir em que momento do clipe cada estrutura aparecia, nem saber quanto do vídeo foi examinado.
- Texto periférico e cadastro entravam na mesma leitura visual.
- As porcentagens de confiança eram geradas pelo próprio modelo, sem calibração.

**Correção.** O fluxo virou: preparo dos quadros (ffmpeg: 8 quadros distribuídos, com instante, e recorte da região da imagem por densidade de pixels) → leitor de tela (só transcreve) → leitor visual (recebe só os recortes numerados, sem cadastro, sem histórico e sem texto da tela) → cruzamento (cada verificação com a sua fonte) → redator → verificador. Não há mais porcentagens. Uma identificação sem quadro conferível é rebaixada para "hipótese", e uma gestação sem quadro vira "inconclusiva".

| | Antes (v2, produção) | Depois (v3) |
| --- | --- | --- |
| "Gabriel" | campo `animal_id` → bloqueio `animal_divergente` | texto da tela com o papel provável "identificação do paciente" → alerta `identificacao_a_conferir` ("o significado desse texto não está confirmado") |
| Cobertura | não informada | 8 quadros de 0,3 s a 4,7 s, num clipe de 5 s; recorte x180 y92 280×436 |
| Estruturas | ovário e folículo, com porcentagem "ALTA" | ovário (quadros 1–8), corpo lúteo (1–8) e folículo (5–8), cada um com evidência, características e estado "compatível com o esperado no que foi visualizado" |
| Gestação | campo com confiança | "não demonstrada neste clipe"; não avaliados: corno uterino, corpo uterino, ovário contralateral |
| Arquivo corrompido | — | `falha_no_processamento`, que é diferente de "sem achados" |

**Variabilidade.** Rodei de novo com outro brinco, outro nome e outro histórico. As estruturas e o status da gestação saíram iguais, mas o corpo lúteo veio como "hipótese" em vez de "identificado". Isso é variabilidade do modelo. As identificações são experimentais, sem desempenho validado.

Validação reproduzível: `node agents/ultrasound-agent/eval/validate-reference.js <arquivo.AVI>` (5 verificações: fontes separadas, quadros citados, cobertura, nada do cadastro na saída visual, falha de processamento explícita).

## Avaliação da leitura com exames reais (a fazer)

A qualidade do Leitor só pode ser medida com exames reais rotulados por médico-veterinário. O avaliador já está pronto:

```bash
GEMINI_API_KEY=... GEMINI_MODEL=... node agents/ultrasound-agent/eval/run-eval.js <pasta-com-labels.json>
```

Ele mede, por campo: **acerto** (com tolerância de 5 dias na idade gestacional e 2 mm nas medidas), **cobertura** (o Leitor respondeu algo), **número inventado** (respondeu número onde o rótulo diz que não havia) e **latência mediana**. Nenhum resultado foi medido ainda: o repositório não traz exames reais.

**Metas propostas** (a confirmar com o veterinário parceiro):

| Métrica | Meta proposta | Resultado medido |
| --- | --- | --- |
| Acerto de gestação (prenhe ou vazia) | 90% | Ainda não medido |
| Acerto da idade gestacional lida na tela (±5 dias) | 95% | Ainda não medido |
| Números inventados | 0 (meta de segurança) | Ainda não medido |
| Rascunhos aprovados pelo veterinário sem correção | 70% | Ainda não medido |
| Latência mediana por exame | até 20 s | Ainda não medido |

## Em produção: como saber se piorou

- Cada execução gera uma linha de log `[ultrasound-agent]` com status, etapas, tokens e se houve bloqueio (sem imagem e sem texto clínico).
- O exame salvo guarda `ai_confidence` e a narrativa; a aprovação fica no log de auditoria da AcomGest.
- Sinais de degradação: aumento de `leitura_invalida` ou `falha_no_modelo`, mais `baixa_confianca`, e mais rascunhos corrigidos pelo veterinário antes de aprovar.
