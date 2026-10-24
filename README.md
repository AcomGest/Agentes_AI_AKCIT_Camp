# Agente de Ultrassonografia AcomGest

Agente de IA que transforma o vídeo ou as imagens exportados do aparelho de ultrassom em um rascunho de prontuário do animal, cruzado com o histórico reprodutivo, para o médico-veterinário revisar e assinar. Roda dentro do módulo de Ultrassom da [AcomGest](https://app.acomgest.com.br), plataforma de gestão pecuária.

Projeto apresentado no **AKCIT Camp Multicêntrico 2026 — Hackathon Centro-Oeste (Goiânia, 24/10/2026)**.

## Em uma frase por etapa

1. **Guarda de entrada** — recusa arquivo inválido antes de gastar IA.
2. **Leitor (VLM, Gemini)** — lê a tela e a imagem e devolve JSON com valor, confiança e evidência por campo.
3. **Cruzamento** — confere a leitura com a inseminação, a IATF e os exames anteriores do animal.
4. **Redator (LLM)** — escreve a narrativa só com os fatos.
5. **Verificador** — recusa número inventado ou recomendação.

O resultado é um **rascunho**: só vira prontuário quando um usuário com perfil Veterinário aprova.

## Documentação

| Documento | Conteúdo |
| --- | --- |
| [Fluxo do agente](docs/fluxo-do-agente.md) | Entradas, lógica e saídas (entregável do edital) |
| [Arquitetura](docs/arquitetura.md) | Componentes, por que vários agentes, onde fica o estado, implantação |
| [Avaliação e guardrails](docs/avaliacao-e-guardrails.md) | Proteções, testes executados, avaliação com exames reais |
| [Dados, LGPD e observabilidade](docs/lgpd-e-observabilidade.md) | Que dados passam, retenção, logs, como investigar uma resposta ruim |
| [BMC](docs/bmc.md) | Business Model Canvas |
| [Pitch de 3 minutos](docs/pitch-3min.md) | Roteiro e perguntas prováveis |

## Rodar

Requer Node.js 22 ou mais recente. Sem dependências externas.

```bash
# testes do agente (modelo falso, sem chave)
node test/harness.test.js

# demonstração sem chave (leitura SIMULADA, marcada como tal)
node demo.js --simulado --file exame.png --animal 1042 --date 2026-10-20 --service 2026-09-05:IATF

# demonstração real
GEMINI_API_KEY=... GEMINI_MODEL=<modelo com visão> \
  node demo.js --file exame.mp4 --animal 1042 --date 2026-10-20 --service 2026-09-05:IATF

# avaliação com exames rotulados por veterinário
GEMINI_API_KEY=... GEMINI_MODEL=... node eval/run-eval.js <pasta-com-labels.json>
```

## Estado em 24/10/2026

| Parte | Situação |
| --- | --- |
| Orquestrador, Guarda, Leitor, Cruzamento, Redator, Verificador | Feitos e testados com modelo falso (7 cenários) |
| Rota e tela no módulo de Ultrassom da AcomGest; aprovação só pelo Veterinário | Feitas e testadas no servidor (6 cenários, SQLite) |
| Qualidade da leitura com exames reais | Ainda não medida: falta o conjunto rotulado por veterinário |
| Armazenamento do arquivo do exame | A construir (hoje só o hash) |

## Licença

MIT — ver [LICENSE](LICENSE).
