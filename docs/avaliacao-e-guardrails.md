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
| `agents/ultrasound-agent/test/harness.test.js` | Guarda recusa sem chamar o modelo; caminho feliz; contrato inválido com nova tentativa e falha fechada; falha do modelo; animal divergente, idade gestacional divergente e medida sem tela bloqueiam; prenhe sem serviço e vazia após positivo; Verificador recusa número inventado e recomendação | 7 de 7 cenários passaram |
| `scripts/backend-ultrasound-agent-smoke-test.cjs` | Servidor real (SQLite): analisar não grava; sem permissão 403; outra fazenda 404; arquivo inválido 400; rascunho salvo com IA = Sim; Gerente não aprova; Veterinário aprova; exame sem IA mantém a regra antiga | 6 de 6 cenários passaram |

Os dois testes usam um modelo falso: eles provam a lógica do agente, não a qualidade da leitura do Gemini.

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
