# Business Model Canvas — Agente de Ultrassonografia AcomGest

Itens marcados **(a validar)** são hipóteses da equipe, ainda sem entrevista ou dado que as sustente.

| Bloco | Conteúdo |
| --- | --- |
| **Segmentos de clientes** | Médicos-veterinários de reprodução que atendem várias fazendas de corte e de leite; fazendas que já usam a AcomGest para gerir o rebanho, a reprodução e a IATF. Começo por Goiás (23,2 milhões de bovinos, IBGE, via [Agrolink](https://www.agrolink.com.br/noticias/bovinocultura-goiana-mantem-crescimento_509326.html)) |
| **Proposta de valor** | O exame de ultrassom vira prontuário no mesmo dia: o agente lê o vídeo ou a imagem do aparelho, confere com a inseminação, a IATF e os exames anteriores do animal, e entrega um rascunho que o veterinário só revisa e assina. Menos digitação, menos erro de animal trocado, alerta de incoerência antes de assinar |
| **Canais** | Módulo de Ultrassom dentro da AcomGest (web, em [app.acomgest.com.br](https://app.acomgest.com.br)); indicação entre veterinários **(a validar)** |
| **Relacionamento** | O veterinário corrige e aprova cada rascunho, e essas correções alimentam a avaliação do agente; suporte direto da equipe no piloto |
| **Fontes de receita** | Assinatura da AcomGest com o agente incluído ou cobrado por exame analisado **(a validar)**; preço a definir depois de medir o custo real por exame |
| **Recursos-chave** | Base de dados do rebanho da AcomGest (reprodução, IATF, exames, ficha do animal); regras de cruzamento com conhecimento do domínio; conjunto de exames rotulados por veterinários (a construir) |
| **Atividades-chave** | Melhorar o Leitor com exames reais; manter as regras de cruzamento; validar parâmetros clínicos com veterinários; operar e monitorar o agente |
| **Parcerias-chave** | Veterinários parceiros para rotular exames e validar as regras **(a validar)**; provedor do modelo (Google Gemini); infraestrutura (Google Cloud, Supabase) |
| **Estrutura de custos** | Tokens do modelo por exame (medido a cada execução; valor real só após as primeiras execuções); servidor e banco; tempo de veterinário para rotular a base de avaliação |

## Diferencial e defensibilidade

- **Integração com o histórico:** um leitor de imagem genérico não sabe quando a vaca foi inseminada; o agente sabe, porque roda dentro da AcomGest.
- **Conhecimento do domínio no código:** as verificações (idade gestacional contra o serviço, medida só da tela, clipe sem gestação depois de um exame positivo) são regras do domínio, auditáveis.
- **Base própria:** cada rascunho corrigido pelo veterinário vira um exemplo rotulado para avaliar e melhorar o Leitor.
