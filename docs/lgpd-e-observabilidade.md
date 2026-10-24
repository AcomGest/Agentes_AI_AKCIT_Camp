# Dados, LGPD e observabilidade

## Que dados passam pelo agente

| Dado | Tem dado pessoal? | O que acontece |
| --- | --- | --- |
| Vídeo e imagens do exame | Em geral não (imagem de órgão animal). A tela do aparelho pode mostrar nome da clínica ou do veterinário | Enviados à Gemini API para a leitura. O servidor da AcomGest não guarda o arquivo: guarda só o hash SHA-256 |
| Animal, data, histórico reprodutivo | Não | Lidos do banco da fazenda, só da fazenda do usuário |
| Nome do veterinário | Sim (nome) | Fica no exame salvo, como já acontece no módulo de Ultrassom |
| Rascunho e narrativa | Não, salvo o nome acima | Só é gravado quando o usuário salva |

## Retenção

- O agente não tem memória própria e não grava nada.
- O exame salvo segue a retenção do módulo de Ultrassom da AcomGest.
- O arquivo do exame não é armazenado pela AcomGest hoje.

## Pontos em aberto

- **Região de processamento do Gemini:** confirmar nos termos do plano contratado e informar no Aviso de Privacidade antes de ligar em produção (a mesma pendência já registrada para o WhatsApp).
- **Uso dos dados pelo provedor:** confirmar nos termos do plano da Gemini API se os dados enviados são usados para treinamento e escolher um plano que não use.

## Observabilidade

| O que | Onde | Para quê |
| --- | --- | --- |
| Rastro da execução (`trace`) | Resposta da API | Ver etapa por etapa o que o agente fez, com tempo e tokens |
| Linha de log `[ultrasound-agent]` | Cloud Logging | Status, etapas, tokens, bloqueio, modo simulado; sem imagem nem texto clínico |
| Proveniência (`provenance`) | Resposta da API | Hash da mídia, modelo e versão do prompt (`ultrassom-leitor-v1`) |
| Auditoria da aprovação | Log de auditoria da AcomGest | Quem aprovou e quando |

**Como investigar uma resposta ruim:** pegue o hash da mídia e a versão do prompt na proveniência, reproduza com `demo.js` no mesmo arquivo, confira no rastro qual etapa produziu o erro (Leitor ou Cruzamento) e, se foi o Leitor, adicione o exame ao conjunto de avaliação.

**Custo:** cada execução registra tokens de entrada e saída do Leitor e do Redator. O custo por exame é calculado multiplicando esses tokens pelo preço do modelo escolhido; o valor real só existe depois das primeiras execuções com chave.
