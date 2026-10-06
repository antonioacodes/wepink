# Loja configurável — questionário, produto, checkout Pix e painel

Loja independente do GOTAXI, com o rosa `#ff008a`, cartões arredondados e fluxo inspirado na referência fornecida. Identidade provisória **sua marca**; nome, logo, cor, fotos, conteúdo, preços, perguntas, fretes e políticas são editáveis no painel. As ilustrações de frascos são placeholders locais e devem ser substituídas pelas imagens do catálogo.

## Executar

Requer Node.js 24+ e pnpm 11.19.0 (ou npm para instalar as dependências).

```sh
pnpm install --frozen-lockfile
cp .env.example .env
npm run admin:password
# Cole o hash gerado em ADMIN_PASSWORD_HASH no .env.
npm start
```

- Pesquisa: http://127.0.0.1:3000/inicio/
- Produto: http://127.0.0.1:3000/produto/
- Checkout: http://127.0.0.1:3000/checkout/?kit=1
- Painel: http://127.0.0.1:3000/admin/

Não existe senha administrativa padrão. O comando de criação lê a senha sem exibi-la. A senha deve ter pelo menos 12 caracteres; apenas seu hash scrypt fica na configuração. Ao trocar a senha, revogue também as sessões existentes (pare o serviço e remova os registros da tabela `sessions`).

## Painel

- Visão geral: receita confirmada, pedidos, pesquisas concluídas.
- Identidade: nome, logotipo, cor, empresa e atendimento.
- Campanha: apresentação, imagem, perguntas/respostas e resultado.
- Produtos: kit, galeria, detalhes, características, combo e três ofertas opcionais.
- Frete e checkout: modalidades, preços e habilitação das compras.
- Textos: sobre a marca, privacidade e trocas/devoluções.
- Pixup: status da configuração e URL do webhook. Segredos são configurados **somente no servidor**.
- Pedidos: cliente, endereço, itens, pagamento e código de rastreio.

As alterações são persistidas no SQLite; não dependem de localStorage. Salvamento concorrente usa revisão para evitar sobrescrever alterações de outra sessão. Uploads aceitam PNG/JPG/WebP até 2 MB. Não há HTML ou JavaScript arbitrário nos campos do painel.

## Pixup

Configure no `.env`:

```dotenv
PUBLIC_ORIGIN=https://seu-dominio.com
PIXUP_CLIENT_ID=...
PIXUP_CLIENT_SECRET=...
PIXUP_WEBHOOK_SECRET=...
PAYMENTS_ENABLED=true
```

No painel Pixup, configure o mesmo segredo de webhook e a URL `https://seu-dominio.com/api/webhooks/pixup`. Reinicie o serviço. Complete os dados da empresa e as políticas no painel da loja e habilite o checkout. Antes disso, é possível navegar no fluxo, mas não gerar uma cobrança.

A implementação utiliza OAuth Basic, `POST /v2/transactions/cashin`, `external_id` estável por pedido, QR Code e copia e cola. O valor é recalculado pelo servidor. Uma repetição do mesmo pedido recupera a mesma cobrança. Eventos exigem HMAC SHA-256 do corpo bruto, timestamp de até 5 minutos, transação, moeda e valor correspondentes. Webhooks duplicados são idempotentes. Eventos de expiração não rebaixam pedidos pagos; estornos não voltam a pagos com uma confirmação tardia. O cabeçalho sandbox marca pedidos de teste e os exclui da receita.

Documentação consultada em 06/10/2026:
- https://dev.pixupbr.com/introduction
- https://dev.pixupbr.com/payments/cashin
- https://dev.pixupbr.com/webhooks

**A integração foi testada com um adaptador simulado, sem usar credenciais ou movimentar dinheiro.** Ainda é necessário testar na conta Pixup do lojista, com credenciais sandbox e HTTPS acessível, antes de ativar vendas reais. A confirmação depende da entrega do webhook; se houver falha de entrega, use a reentrega pelo painel Pixup. Não há reconciliação periódica neste escopo.

## Publicar na VPS

```sh
docker compose up -d --build
```

Coloque um proxy HTTPS à frente de `127.0.0.1:3000` e configure `PUBLIC_ORIGIN` exatamente com a origem pública, sem barra final. Exemplo Caddy:

```caddy
seu-dominio.com {
    reverse_proxy 127.0.0.1:3000
}
```

Mantenha uma única instância da aplicação e o volume `shop-data` persistente. Faça backups do volume com a aplicação parada, incluindo o SQLite e uploads. O banco contém dados pessoais de pedidos e deve ficar protegido por permissões de sistema, disco protegido e backups com acesso restrito. Nenhum arquivo de `data/` é servido pelo HTTP, exceto as imagens enviadas em `/uploads/`.

A aplicação não confia no IP encaminhado pelo proxy. Em produção, aplique também limites de requisições no proxy; o limite interno é conservador e pode agrupar visitantes atrás dele. O backend Node/SQLite foi preparado para VPS/Docker; não é um pacote estático para hospedagem Sites/Cloudflare Workers.

## Verificação

```sh
npm test
```

A suíte cobre preços em centavos, validação de catálogo, autenticação, controle de origem, persistência, revisão de configuração, acesso privado a pedidos, geração QR, idempotência, assinaturas inválidas, sandbox, envio e estorno. Nenhuma transação externa é executada nos testes.

## Limites desta entrega

- Fotos, identidade comercial, textos finais e políticas devem ser definidos pelo painel.
- Não replica contadores aleatórios, avaliações fabricadas, alegações de doação ou vínculo com terceiros. Não envia dados a pixels da referência.
- Não envia e-mails/WhatsApp e não contrata frete automaticamente. O operador gerencia o envio e informa o rastreio no painel; o cliente acompanha na mesma sessão do checkout.
- O cadastro não inclui estoque, emissão fiscal, cupom ou conta de cliente.
- A pesquisa usa identificador aleatório e salva apenas perguntas e respostas. O checkout mantém os dados pessoais em memória do formulário, não em armazenamento persistente do navegador. O navegador guarda apenas identificador e token de consulta do pedido na sessão.
- Ativos locais ilustrativos em SVG são parte do projeto, sem uso de logos ou fotografias da campanha de terceiros.
