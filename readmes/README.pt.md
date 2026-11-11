# Cosmos Pay · Carteira multichain não custodial

[English](../README.md) · [Español](README.es.md) · **Português** · [Deutsch](README.de.md) · [Français](README.fr.md)

Carteira **não custodial** para a **Stellar e outras 34 redes** (todas as que os swaps entre redes
liquidam: as cadeias EVM, Solana, Bitcoin, XRP Ledger, Tron, TON, NEAR, Sui, Aptos, Cardano,
Starknet e mais), construída com **Astro + Vite + React (TSX)**. Uma única frase de recuperação é um
endereço em cada uma. Distribui-se como **extensão de navegador** (MV3 · Chrome / Edge / Firefox,
popup **e** painel lateral), **app de desktop** (Tauri · Windows / macOS / Linux), **app móvel**
(Tauri · Android / iOS) e web. Interface plana e mate,
tema claro e escuro, **5 idiomas** (EN/ES/PT/DE/FR; inglês por omissão, e um link pode indicar um: `?lang=pt`), multi-carteira sob uma única
palavra-passe e provider para dapps (`window.cosmosWallet`) para pagamentos e assinaturas.

> **Não custodial a sério:** as chaves são geradas e cifradas no teu dispositivo. Nem a frase de
> recuperação nem a chave secreta saem dele. Os servidores só recebem transações já assinadas.

## Funcionalidades

| Função | Detalhe |
|---|---|
| Criar / importar / exportar | BIP-39 de 12 palavras + derivação **SEP-5** (`m/44'/148'/0'`); importa de frase ou chave secreta (`S…`) |
| Cofre cifrado | **AES-256-GCM**, chave derivada com **PBKDF2** (600k iterações; as caixas antigas de 210k voltam a ser seladas no primeiro desbloqueio); desbloqueio só em memória |
| Sessão e bloqueio automático | A sessão sobrevive a um recarregamento, ao fecho do popup e ao reinício do navegador, e volta ao ecrã em que estava, até o bloqueio por inatividade (15 min, 1 h, 1 dia por omissão ou 7 dias, nas Definições) a descartar |
| Guarda de assinatura | `assertSafeToSign` descodifica cada XDR antes de assinar e rejeita o que não encaixa no fluxo (ver Modelo de segurança) |
| Saldos, enviar e receber | Todas as redes, cada uma lida do seu próprio endpoint público (uma leitura falhada aparece como indisponível, nunca como zero). Envia em cada rede onde a carteira tem endereço; QR para receber; o envio de XLM cria a conta destino se não existir |
| Swap | Via gateway Cosmos Pay (cotação automática, proteção de slippage) |
| Fiat (on/off-ramp) | Receiver BlindPay (KYC): depósitos e levantamentos por PIX, SPEI, transferências em ARS, PSE, TED, ACH, wire e RTP, **só 18+** |
| Comprar e vender com moeda local (P2P) | Pela API da Cosmos Pay (`/v1/onramp/p2p`, `/v1/offramp/p2p`), a mesma rampa das vistas Fiat da plataforma para desenvolvedores: cada moeda local com os seus métodos de pagamento (transferência bancária, PIX, Nequi, Bancolombia, Yape, Plin, Zelle e mais), cada rede e token do mercado em que a carteira tem endereço, e uma cotação firme quando a implantação a oferece. A ordem abre numa janela alojada onde a pessoa inicia sessão, verifica a identidade e paga ou recebe; uma compra chega ao endereço da própria carteira e uma venda sai dele (assinada pela extensão do navegador). O modo de teste usa o mercado de teste (USDT de teste na Arbitrum Sepolia). Ver [src/lib/p2pRamp.ts](../src/lib/p2pRamp.ts) |
| Atividade | O separador Atividade do Início, por dias: um envio a vermelho, o dinheiro recebido a verde, um swap a azul e uma comissão a tinta com a sua própria marca de recibo |
| Favoritos e mercados | Estrela para fixar ativos no top-5; preços ao vivo (CoinGecko) com números animados |
| Multi-carteira | Criar / importar / trocar sob uma palavra-passe; e-mail editável e saudações por género |
| Provider para dapps | `window.cosmosWallet` (estilo SEP-43): `getAddress`, `getNetwork`, `signTransaction`, `signMessage`, `requestPayment` |
| Ligações SEP-7 | `web+stellar:pay` via provider, protocol handler no Firefox, keyword `pay` e deteção na barra |
| Superfícies da extensão | Popup (400×600) e painel lateral, com preferência persistente |
| Modo de programador | Endpoints redirecionáveis ao vivo (API de preços, gateway de pagamentos, os dois servidores de recuperação, RPC de Solana / Monad) nas Definições |

A derivação de chaves está verificada contra o **vetor de teste oficial SEP-5**.

## Modelo de segurança

1. Ao criar/importar escolhes uma **palavra-passe**; a chave AES deriva de `PBKDF2(palavra-passe, salt, 600 000, SHA-256)`.
2. Frase + chave secreta são seladas com `AES-256-GCM` (IV aleatório) e guardadas cifradas
   (`tauri-plugin-store` no móvel, `localStorage` na web/extensão).
3. Desbloquear decifra **só em memória**; palavra-passe errada falha o tag GCM e é rejeitada.
4. As assinaturas podem exigir a palavra-passe de novo (toggle nas Definições). A janela de
   aprovação de dapps assina localmente — nenhum segredo chega a páginas ou servidores.
   **Passkey em vez de palavra-passe** (web, extensão, desktop e as apps em Android 9+ / iOS 18+): a palavra-passe da app passa a
   ser 32 bytes aleatórios selados sob a saída PRF do WebAuthn da passkey, por isso a impressão
   digital abre o dispositivo e a mesma passkey abre a cópia na nuvem no seguinte.
5. **Bloqueio automático por inatividade:** uma sessão aberta guarda a chave do cofre, por isso o
   bloqueio automático (Definições: 15 min, 1 h, 1 dia por omissão, 7 dias) descarta-a e a
   palavra-passe volta a ser pedida. Até lá a sessão mantém-se entre recarregamentos sob uma chave
   do navegador não extraível.
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
