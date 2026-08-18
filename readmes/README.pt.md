# Cosmos Pay · Carteira Stellar não custodial

[English](../README.md) · [Español](README.es.md) · **Português** · [Deutsch](README.de.md) · [Français](README.fr.md)

Carteira **não custodial** para a rede **Stellar**, construída com **Astro + Vite + React (TSX)**.
Distribui-se como **extensão de navegador** (MV3 · Chrome / Edge / Firefox — popup **e** painel
lateral), **app móvel** (Capacitor · Android / iOS) e web. Interface **glassmorphism** animada,
tema claro e escuro, **5 idiomas** (EN/ES/PT/DE/FR com autodeteção), multi-carteira sob uma única
palavra-passe e provider para dapps (`window.cosmosWallet`) para pagamentos e assinaturas.

> **Não custodial a sério:** as chaves são geradas e cifradas no teu dispositivo. Nem a frase de
> recuperação nem a chave secreta saem dele. Os servidores só recebem transações já assinadas.

## Funcionalidades

| Função | Detalhe |
|---|---|
| Criar / importar / exportar | BIP-39 de 12 palavras + derivação **SEP-5** (`m/44'/148'/0'`); importa de frase ou chave secreta (`S…`) |
| Cofre cifrado | **AES-256-GCM**, chave derivada com **PBKDF2** (210k iterações); desbloqueio só em memória |
| Bloqueio automático | A sessão é descartada após 5 minutos de inatividade; voltar exige a palavra-passe |
| Guarda de assinatura | `assertSafeToSign` descodifica cada XDR antes de assinar e rejeita o que não encaixa no fluxo (ver Modelo de segurança) |
| Saldos, enviar e receber | Horizon; QR para receber; o envio de XLM cria a conta destino se não existir |
| Swap | Via gateway Cosmos Pay (cotação automática, proteção de slippage) |
| Fiat (on/off-ramp) | Receiver BlindPay (KYC) — depósitos e levantamentos, **só 18+** |
| Histórico | Últimas operações com ícones por cor (verde entra / vermelho sai / branco neutro) + marcador génesis |
| Favoritos e mercados | Estrela para fixar ativos no top-5; preços ao vivo (CoinGecko) com números animados |
| Multi-carteira | Criar / importar / trocar sob uma palavra-passe; e-mail editável e saudações por género |
| Provider para dapps | `window.cosmosWallet` (estilo SEP-43): `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| Ligações SEP-7 | `web+stellar:pay` via provider, protocol handler no Firefox, keyword `pay` e deteção na barra |
| Superfícies da extensão | Popup (400×600) e painel lateral, com preferência persistente |
| Modo de programador | Endpoints redirecionáveis ao vivo (API de preços, Developer Platform, gateway) nas Definições |

A derivação de chaves está verificada contra o **vetor de teste oficial SEP-5**.

## Modelo de segurança

1. Ao criar/importar escolhes uma **palavra-passe**; a chave AES deriva de `PBKDF2(palavra-passe, salt, 210 000, SHA-256)`.
2. Frase + chave secreta são seladas com `AES-256-GCM` (IV aleatório) e guardadas cifradas
   (`@capacitor/preferences` no móvel, `localStorage` na web/extensão).
3. Desbloquear decifra **só em memória**; palavra-passe errada falha o tag GCM e é rejeitada.
4. As assinaturas podem exigir a palavra-passe de novo (toggle nas Definições). A janela de
   aprovação de dapps assina localmente — nenhum segredo chega a páginas ou servidores.
5. **Bloqueio automático por inatividade:** uma sessão aberta guarda a chave decifrada, por isso ao
   fim de 5 minutos sem interação é descartada e a palavra-passe volta a ser pedida.
6. **Nada é assinado sem ser descodificado antes.** Tudo o que a wallet assina e não construiu ela
   própria (o envelope devolvido pelo gateway, o entregue por uma dapp) passa por
   `assertSafeToSign`: descodifica o XDR, confirma que a origem somos nós, permite apenas as
   operações que aquele fluxo pode conter, recusa as de tomada de conta (`setOptions`,
   `accountMerge`, patrocínio, clawback), limita a taxa, recusa invólucros fee-bump e limita o
   montante pela cotação que o utilizador acabou de confirmar. Recusa, não avisa.
7. A **passphrase de rede nunca vem da contraparte** — é lida da configuração de rede da própria
   wallet, para que uma aprovação de "Testnet" não possa produzir uma assinatura válida na Mainnet.
   `signMessage` assina um digest com separação de domínio, nunca os bytes de quem chama.

> A palavra-passe **não é recuperável**. Se a esqueceres, remove essa carteira do dispositivo
> e restaura-a com a frase (as outras carteiras não são afetadas).

## Desenvolvimento

Requer **Node ≥ 22.12** (exigido pelo motor do Astro 7; além disso os scripts de build e teste usam
`--experimental-strip-types`, disponível desde 22.6). O CI corre em Node 22.

```bash
npm install
npm run dev                  # http://localhost:4500
npm run build                # -> dist/web/
npm run test:unit            # node:test, sem dependências
npm run build:ext            # -> dist/extension/          (Chrome / Edge)
npm run build:ext:firefox    # -> dist/extension-firefox/  (Firefox)
```

- **Chrome / Edge:** `chrome://extensions` → modo de programador → *Load unpacked* → `dist/extension/`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `dist/extension-firefox/manifest.json`.

Texto para a loja: [STORE_LISTING.md](../STORE_LISTING.md).

## Aviso

Audita o código e testa a fundo na **Testnet** antes de usar fundos reais. Guarda a frase de
recuperação fora do dispositivo. As funções fiat exigem maioridade (18+).
