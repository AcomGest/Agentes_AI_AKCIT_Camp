# Roteiro do pitch — 3 minutos

| Tempo | O que falar | O que mostrar |
| --- | --- | --- |
| 0:00–0:30 | **Problema.** O veterinário faz o ultrassom no curral, anota no papel e digita depois. Erro de animal trocado, data errada, laudo que não bate com a inseminação aparecem semanas depois. | Foto do exame no curral **(trazer uma real)** |
| 0:30–0:50 | **Solução.** Um agente que transforma o vídeo do aparelho em prontuário, conferido com o histórico do animal, e que só o veterinário assina. | Tela do módulo de Ultrassom, botão "Analisar com IA" |
| 0:50–1:50 | **Demo.** Envio o vídeo da vaca 1042. O Leitor lê a tela e a imagem; o Cruzamento confere a idade gestacional com a IATF de 05/09; o Redator escreve o rascunho; o Verificador garante que não há número inventado. O Gerente tenta aprovar e é barrado; o veterinário aprova. | Painel com leitura, confiança, verificações e rascunho; aprovação |
| 1:50–2:20 | **Por que é um agente e por que é seguro.** Cinco papéis: dois com IA, três com regras. Número só da tela; animal divergente bloqueia; nada grava sem o veterinário; rastro de cada etapa com tempo e tokens. | Diagrama do fluxo ([fluxo-do-agente.md](fluxo-do-agente.md)) |
| 2:20–2:45 | **Negócio.** Roda dentro da AcomGest, que já gere rebanho, reprodução e IATF. Cada correção do veterinário vira dado para medir e melhorar. Começo por Goiás. | BMC ([bmc.md](bmc.md)) |
| 2:45–3:00 | **Próximo passo.** Piloto com veterinários parceiros para rotular exames e medir o acerto do Leitor. | Tabela de metas ([avaliacao-e-guardrails.md](avaliacao-e-guardrails.md)) |

## Perguntas prováveis da banca

- **"De onde vêm os números?"** Só de medidas escritas na tela do aparelho; o código bloqueia número estimado a olho.
- **"E se o modelo errar?"** O Cruzamento e o Verificador pegam incoerências; o veterinário vê a confiança e a evidência de cada campo e decide.
- **"Por que vários agentes?"** Perceber, conferir e escrever são tarefas diferentes; separar deixa cada uma testável e auditável.
- **"Qual o acerto?"** Ainda não medido com exames reais; o avaliador está pronto e o piloto com veterinários vai gerar o número.
- **"E a LGPD?"** O arquivo não fica guardado na AcomGest, só o hash; nada é gravado sem o usuário; logs sem imagem e sem texto clínico.

## Antes de apresentar

- Gerar uma chave nova do Gemini (a que circulou em conversa precisa ser revogada) e configurar `GEMINI_API_KEY` e o modelo.
- Ter um vídeo ou uma imagem real exportada do aparelho, com a autorização do dono do animal.
- Se a demo for sem chave, deixar claro que é o modo simulado; a tela já avisa.
