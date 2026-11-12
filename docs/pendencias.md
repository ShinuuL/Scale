# Pendencias

## Verificacao de idade por ferramenta externa (compartilhar tela)

**Situacao atual:** o usuario informa a data de nascimento. E facil de burlar;
vale apenas como declaracao.

**Decisao (2026-11-12):** manter a declaracao por enquanto e adotar a opcao
**mais simples e gratuita** quando houver uma viavel. Fica pendente.

| Opcao | Custo | Observacao |
|-------|-------|------------|
| Login gov.br (selo de idade) | Gratuito para orgaos publicos; empresa privada precisa de convenio | Mais forte; acesso dificil para o Scale |
| Estimativa por selfie (Yoti e similares) | Pago por verificacao (camada gratuita limitada) | Dado biometrico: exige base legal e RIPD (LGPD) |
| Documento + selfie (Unico, idwall, Serpro Datavalid) | Pago | Mais robusto; contrato e DPA com o fornecedor |
| Login Google/GitHub como sinal | Gratuito | Nao comprova idade; so dificulta contas descartaveis |

**Antes de implementar:**
- Escolher o fornecedor e confirmar que ha camada gratuita ou o orcamento.
- LGPD: guardar somente "maior de 18: sim/nao" e a data da verificacao, nunca o
  documento nem a imagem; atualizar a politica de privacidade.
- O servidor confere o resultado (webhook/token assinado do fornecedor); nunca
  confiar em flag enviada pelo cliente.
