/**
 * WalletConnect's state: the sessions this wallet holds with sites, and the proposals and
 * requests waiting for the person. A slice of the store (`src/state/store.ts` composes it and
 * hands it the one thing it cannot do itself: sign, behind the signing gate).
 *
 * The rules are not here: what may be paired, offered and routed is `src/lib/walletConnect.ts`;
 * what a request asks, and whether it may be signed, `src/lib/evmReview.ts` — the reading the
 * extension's approval window makes too. This file only moves events between the SDK
 * (`src/lib/walletConnectClient.ts`) and the approval sheets (`src/features/walletconnect/`).
 *
 * A session is bound to the wallet, mode and account it was approved for (`WcBinding`, kept in
 * `lib/storage.ts`): after a wallet switch or a mode change it is kept but cannot sign — every
 * request is checked against the wallet as it is NOW (`wcRouteRequest`, `wcBindingCurrent`) —
 * until the person comes back to it or disconnects it in Settings → Connected sites.
 *
 * Listening only happens while the wallet is unlocked. A request that arrives while it is locked
 * stays with the SDK and is shown on the next unlock (`getPendingSessionRequests`); a proposal
 * that arrives then is not (the SDK keeps no Verify verdict for it) and the site shows its QR again.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChainNet } from '@/constants/chains';
import { WC_BINDINGS_KEY, WC_QUEUE_MAX } from '@/constants/walletConnect';
import { EVENT } from '@/constants/telemetry';
import { storageGet, storageSet } from '@/lib/storage';
import { reportError } from '@/lib/telemetry';
import {
  WC_ERR,
  WC_PROPOSAL_ERRORS,
  chainIdOf,
  offeredChains,
  parseWcUri,
  wcBindingCurrent,
  wcProposalProblem,
  wcRouteRequest,
  wcSupported,
  wcSwitchTarget,
  wcVerifyState,
  type WcBinding,
  type WcError,
  type WcProposalProblem,
  type WcVerify,
} from '@/lib/walletConnect';
import type { EvmReview } from '@/lib/evmReview';
import {
  wcApprovedNamespaces,
  wcClient,
  wcErrorResponse,
  wcResult,
  type WcProposalEvent,
  type WcRequestEvent,
  type WcSession,
} from '@/lib/walletConnectClient';

/** A site, as it describes itself. Its name is its claim; its host is what the person checks. */
export interface WcPeer {
  name: string;
  url: string;
  host: string;
}

export type WcPending =
  | {
      kind: 'proposal';
      id: number;
      peer: WcPeer;
      verify: WcVerify;
      /** The chain ids the session would hold. */
      chains: number[];
      problem: WcProposalProblem | null;
    }
  | {
      kind: 'request';
      id: number;
      topic: string;
      peer: WcPeer;
      verify: WcVerify;
      /** As the site sent them: what the request is checked against again before it is signed. */
      chain: string;
      method: string;
      params: unknown;
      review: EvmReview;
    };

type PendingProposal = Extract<WcPending, { kind: 'proposal' }>;
type PendingRequest = Extract<WcPending, { kind: 'request' }>;

export interface WcSessionView {
  topic: string;
  peer: WcPeer;
  /** The account it was approved for. */
  account: string | null;
  chains: number[];
  /** Approved for the wallet, mode and account active now: only then can it sign. */
  current: boolean;
}

export interface WalletConnectDeps {
  /** This build has a project id (`wcEnabled`). */
  enabled: boolean;
  /** A session is open (the wallet is unlocked). */
  active: boolean;
  walletId: string | null;
  env: ChainNet;
  /** The wallet's 0x account in the current mode. */
  account: string | null;
  t: (key: string, params?: Record<string, string | number>) => string;
  flash: (msg: string, kind?: 'ok' | 'err' | 'info') => void;
  /**
   * Sign or send what `review` asks, behind the signing gate. Null when the person did not get
   * past the gate (the request stays waiting); throws when it is refused or fails.
   */
  sign: (review: EvmReview, peer: WcPeer) => Promise<string | null>;
}

function peerOf(meta: { name?: unknown; url?: unknown } | undefined): WcPeer {
  const url = typeof meta?.url === 'string' ? meta.url : '';
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  const name = typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim() : host;
  return { name, url, host };
}

function chainsOfSession(s: WcSession): number[] {
  const ns = s.namespaces?.eip155;
  const chains = ns?.chains ?? ns?.accounts?.map((a) => a.split(':').slice(0, 2).join(':')) ?? [];
  return [...new Set(chains)].map((c) => chainIdOf(c)).filter((n): n is number => n !== null);
}

/** A refusal's text for the person: its i18n key when it carries one, else its message. */
function failureText(e: unknown, t: WalletConnectDeps['t'], fallback: string): string {
  const key = (e as { key?: unknown } | null)?.key;
  return typeof key === 'string' ? t(key) : fallback;
}

/** The request review (`lib/evmReview.ts`), loaded when a request arrives: it carries the curve. */
const reviewLib = () => import('@/lib/evmReview');

export function useWalletConnect(d: WalletConnectDeps) {
  // The queue lives in a ref (the event handlers need to know at once whether something was
  // added); the state mirrors it for rendering.
  const queueRef = useRef<WcPending[]>([]);
  const [queue, setQueue] = useState<WcPending[]>([]);
  const setQ = useCallback((next: WcPending[]) => {
    queueRef.current = next;
    setQueue(next);
  }, []);
  const [rawSessions, setRawSessions] = useState<WcSession[]>([]);
  const bindingsRef = useRef<Record<string, WcBinding>>({});
  const [bindings, setBindings] = useState<Record<string, WcBinding>>({});
  const [pairing, setPairing] = useState(false);
  // Handlers registered once per unlock read the wallet as it is when an event arrives.
  const deps = useRef(d);
  deps.current = d;

  const saveBindings = useCallback(async (next: Record<string, WcBinding>) => {
    bindingsRef.current = next;
    setBindings(next);
    await storageSet(WC_BINDINGS_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const refreshSessions = useCallback(async () => {
    const kit = await wcClient();
    setRawSessions(Object.values(kit.getActiveSessions()));
  }, []);

  const enqueue = useCallback(
    (p: WcPending): boolean => {
      const q = queueRef.current;
      if (q.some((x) => x.kind === p.kind && x.id === p.id) || q.length >= WC_QUEUE_MAX) return false;
      setQ([...q, p]);
      return true;
    },
    [setQ],
  );
  const drop = useCallback((pred: (p: WcPending) => boolean) => setQ(queueRef.current.filter((p) => !pred(p))), [setQ]);

  const respond = useCallback(async (topic: string, id: number, result: { ok: true; value: unknown } | { ok: false; error: WcError }) => {
    const kit = await wcClient();
    await kit.respondSessionRequest({ topic, response: result.ok ? wcResult(id, result.value) : wcErrorResponse(id, result.error) });
  }, []);

  /* ------------------------------------------------------------ events */

  /**
   * Listen to the SDK: once per unlock, and only when there is something to listen for — a
   * session kept from before (its binding is on record) or a pairing the person started. A wallet
   * that never used WalletConnect never loads the SDK nor opens the relay's socket.
   */
  const attachedRef = useRef<{ kit: Awaited<ReturnType<typeof wcClient>>; detach: () => void } | null>(null);
  const attaching = useRef<Promise<Awaited<ReturnType<typeof wcClient>>> | null>(null);

  const attach = useCallback((): Promise<Awaited<ReturnType<typeof wcClient>>> => {
    if (attachedRef.current) return Promise.resolve(attachedRef.current.kit);
    attaching.current ??= (async () => {
      const kit = await wcClient();

      const onProposal = (ev: WcProposalEvent) => {
        const { env, account } = deps.current;
        const p = ev.params;
        setPairing(false);
        enqueue({
          kind: 'proposal',
          id: ev.id,
          peer: peerOf(p.proposer?.metadata),
          verify: wcVerifyState(ev.verifyContext),
          chains: offeredChains(p.requiredNamespaces, p.optionalNamespaces, env),
          problem: wcProposalProblem(p.requiredNamespaces, p.optionalNamespaces, env, account),
        });
      };

      const onRequest = async (ev: WcRequestEvent) => {
        const { env, account, walletId, t, flash } = deps.current;
        const session = kit.getActiveSessions()[ev.topic];
        const peer = peerOf(session?.peer?.metadata);
        const refuse = async (error: WcError, key: string) => {
          await respond(ev.topic, ev.id, { ok: false, error }).catch(() => {});
          flash(t(key, { site: peer.host || peer.name }), 'err');
        };
        if (!session) return refuse(WC_ERR.unsupportedAccounts, 'wc.err.account');
        const { request, chainId } = ev.params;
        const route = wcRouteRequest(session, chainId, request.method, request.params, env, account);
        if (!route.ok) return refuse(route.error, route.key);
        // A session approved for another wallet or mode never signs for the one active now.
        if (!wcBindingCurrent(bindingsRef.current[ev.topic], walletId, env, account)) return refuse(WC_ERR.unsupportedAccounts, 'wc.err.account');
        if (route.method === 'wallet_switchEthereumChain') {
          const target = wcSwitchTarget(session, route.params, env);
          if ('error' in target) return refuse(target.error, 'wc.err.chain');
          await kit.emitSessionEvent({ topic: ev.topic, event: { name: 'chainChanged', data: target.chainId }, chainId: `eip155:${target.chainId}` }).catch(() => {});
          await respond(ev.topic, ev.id, { ok: true, value: null }).catch(() => {});
          return;
        }
        const review = (await reviewLib()).reviewEvmRequest({ method: route.method, params: route.params, chainId: route.chainId, account, env });
        const added = enqueue({ kind: 'request', id: ev.id, topic: ev.topic, peer, verify: wcVerifyState(ev.verifyContext), chain: chainId, method: request.method, params: request.params, review });
        if (!added && !queueRef.current.some((x) => x.kind === 'request' && x.id === ev.id)) await refuse(WC_ERR.userRejected, 'wc.err.busy');
      };

      const onDelete = (ev: { topic: string }) => {
        drop((x) => x.kind === 'request' && x.topic === ev.topic);
        const next = { ...bindingsRef.current };
        delete next[ev.topic];
        void saveBindings(next);
        void refreshSessions().catch(() => {});
      };
      const onExpire = (ev: { id: number }) => drop((x) => x.id === ev.id);
      const onRequestEvent = (ev: WcRequestEvent) => void onRequest(ev).catch((e) => reportError(EVENT.walletConnectError, e, { where: 'request' }));

      kit.on('session_proposal', onProposal);
      kit.on('session_request', onRequestEvent);
      kit.on('session_delete', onDelete);
      kit.on('proposal_expire', onExpire);
      kit.on('session_request_expire', onExpire);
      attachedRef.current = {
        kit,
        detach: () => {
          kit.off('session_proposal', onProposal);
          kit.off('session_request', onRequestEvent);
          kit.off('session_delete', onDelete);
          kit.off('proposal_expire', onExpire);
          kit.off('session_request_expire', onExpire);
        },
      };
      // What arrived while the wallet was locked.
      for (const r of kit.getPendingSessionRequests()) onRequestEvent(r as unknown as WcRequestEvent);
      await refreshSessions();
      return kit;
    })().finally(() => {
      attaching.current = null;
    });
    return attaching.current;
  }, [enqueue, drop, refreshSessions, respond, saveBindings]);

  const detach = useCallback(() => {
    attachedRef.current?.detach();
    attachedRef.current = null;
    setQ([]);
    setPairing(false);
  }, [setQ]);

  useEffect(() => {
    if (!d.enabled || !d.active) {
      detach();
      return;
    }
    let live = true;
    (async () => {
      const saved = await storageGet(WC_BINDINGS_KEY).catch(() => null);
      if (!live) return;
      try {
        const parsed = saved ? (JSON.parse(saved) as Record<string, WcBinding>) : {};
        bindingsRef.current = parsed;
        setBindings(parsed);
      } catch {
        /* a broken record binds nothing: those sessions cannot sign until reconnected */
      }
      if (Object.keys(bindingsRef.current).length) await attach();
      // Locked while it was starting: let go again.
      if (!live) detach();
    })().catch((e) => reportError(EVENT.walletConnectError, e, { where: 'init' }));
    return () => {
      live = false;
      detach();
    };
  }, [d.enabled, d.active, attach, detach]);

  /* ------------------------------------------------------------ actions */

  /** Pair with the site behind a `wc:` URI (scanned or pasted). False when it is not one. */
  const wcPair = useCallback(async (text: string): Promise<boolean> => {
    const { t, flash, enabled } = deps.current;
    const parsed = enabled ? parseWcUri(text) : null;
    if (!parsed) {
      flash(t('wc.badUri'), 'err');
      return false;
    }
    if (!deps.current.active) return false;
    setPairing(true);
    try {
      // Listening first: the site's proposal can arrive before `pair` resolves.
      const kit = await attach();
      await kit.pair({ uri: parsed.uri });
      return true;
    } catch (e) {
      setPairing(false);
      flash(t('wc.pairFailed'), 'err');
      reportError(EVENT.walletConnectError, e, { where: 'pair' });
      return false;
    }
  }, [attach]);

  const proposalOf = (id: number) => queueRef.current.find((p): p is PendingProposal => p.kind === 'proposal' && p.id === id);
  const requestOf = (id: number) => queueRef.current.find((p): p is PendingRequest => p.kind === 'request' && p.id === id);

  /** Approve a proposal for the wallet as it is now; refused when it can no longer be honoured. */
  const wcApproveProposal = useCallback(
    async (id: number) => {
      const p = proposalOf(id);
      if (!p) return;
      const { env, account, walletId, t, flash } = deps.current;
      drop((x) => x.kind === 'proposal' && x.id === id);
      const kit = await wcClient();
      const raw = Object.values(kit.getPendingSessionProposals()).find((x) => x.id === id);
      const problem = raw ? wcProposalProblem(raw.requiredNamespaces, raw.optionalNamespaces, env, account) : 'chains';
      try {
        if (p.verify === 'threat' || problem || !raw || !account || !walletId) {
          await kit.rejectSession({ id, reason: problem ? WC_PROPOSAL_ERRORS[problem] : WC_ERR.userRejected }).catch(() => {});
          flash(t('wc.notConnected'), 'err');
          return;
        }
        const namespaces = await wcApprovedNamespaces(raw, wcSupported(env, account));
        const session = await kit.approveSession({ id, namespaces });
        await saveBindings({ ...bindingsRef.current, [session.topic]: { walletId, env, account } });
        await refreshSessions();
        flash(t('wc.connected', { site: p.peer.host || p.peer.name }), 'ok');
      } catch (e) {
        flash(t('wc.connectFailed'), 'err');
        reportError(EVENT.walletConnectError, e, { where: 'approve' });
        await kit.rejectSession({ id, reason: WC_ERR.userRejected }).catch(() => {});
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drop, refreshSessions, saveBindings],
  );

  const wcRejectProposal = useCallback(
    async (id: number) => {
      drop((x) => x.kind === 'proposal' && x.id === id);
      const kit = await wcClient();
      await kit.rejectSession({ id, reason: WC_ERR.userRejected }).catch(() => {});
    },
    [drop],
  );

  /**
   * Approve a request: checked again against the wallet as it is NOW (it may have been switched,
   * locked and reopened, or moved to the other mode since the request arrived), then signed behind
   * the gate. A refusal answers the site with its code and says why here. `ack` is the person's
   * explicit acknowledgement, required here as on the sheet for whatever needs it.
   */
  const wcApproveRequest = useCallback(
    async (id: number, ack: boolean) => {
      const p = requestOf(id);
      if (!p) return;
      const { env, account, walletId, t, flash, sign } = deps.current;
      const kit = await wcClient();
      const session = kit.getActiveSessions()[p.topic];
      const finish = () => drop((x) => x.kind === 'request' && x.id === id);
      const fail = async (error: WcError, msg: string) => {
        finish();
        await respond(p.topic, id, { ok: false, error }).catch(() => {});
        flash(msg, 'err');
      };
      const site = p.peer.host || p.peer.name;
      if (!session || !wcBindingCurrent(bindingsRef.current[p.topic], walletId, env, account)) return fail(WC_ERR.unsupportedAccounts, t('wc.err.account', { site }));
      if (p.verify === 'threat') return fail(WC_ERR.userRejected, t('wc.verify.threat'));
      const route = wcRouteRequest(session, p.chain, p.method, null, env, account);
      if (!route.ok) return fail(route.error, t(route.key, { site }));
      // Read again: the mode or the account may have changed since it arrived.
      const { reviewEvmRequest, evmReviewNotes, evmFailure } = await reviewLib();
      const review = reviewEvmRequest({ method: route.method, params: p.params, chainId: route.chainId, account, env });
      if (review.refusal || !review.request) {
        return fail({ code: review.refusalCode, message: review.refusalMessage || 'Refused.' }, t(review.refusal ?? 'approve.evm.err.params'));
      }
      // A disabled button is a hint; this is the enforcement (`evmReviewNotes`, as on the sheet).
      if (evmReviewNotes(review, null).needsAck && !ack) return;
      try {
        const value = await sign(review, p.peer);
        if (value === null) return; // the gate was not passed: the request keeps waiting
        finish();
        await respond(p.topic, id, { ok: true, value });
        flash(t(review.request.kind === 'sendTransaction' ? 'wc.sent' : 'wc.signed'), 'ok');
      } catch (e) {
        const failure = evmFailure(e);
        await fail(failure, failureText(e, t, failure.message));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drop, respond],
  );

  const wcRejectRequest = useCallback(
    async (id: number) => {
      const p = requestOf(id);
      if (!p) return;
      drop((x) => x.kind === 'request' && x.id === id);
      const refusal = p.review.refusal ? { code: p.review.refusalCode, message: p.review.refusalMessage || 'Refused.' } : WC_ERR.userRejected;
      await respond(p.topic, id, { ok: false, error: refusal }).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drop, respond],
  );

  /** End a session (the site is told), and forget what it was bound to. */
  const wcDisconnect = useCallback(
    async (topic: string) => {
      const { t, flash } = deps.current;
      const kit = await wcClient();
      await kit.disconnectSession({ topic, reason: WC_ERR.userDisconnected }).catch(() => {});
      drop((p) => p.kind === 'request' && p.topic === topic);
      const next = { ...bindingsRef.current };
      delete next[topic];
      await saveBindings(next);
      await refreshSessions().catch(() => {});
      flash(t('wc.disconnected'), 'ok');
    },
    [drop, refreshSessions, saveBindings],
  );

  const wcSessions: WcSessionView[] = useMemo(
    () =>
      rawSessions.map((s) => {
        const b = bindings[s.topic];
        return {
          topic: s.topic,
          peer: peerOf(s.peer?.metadata),
          account: b?.account ?? null,
          chains: chainsOfSession(s),
          current: wcBindingCurrent(b, d.walletId, d.env, d.account),
        };
      }),
    [rawSessions, bindings, d.walletId, d.env, d.account],
  );

  return {
    wcEnabled: d.enabled,
    /** The proposal or request the person answers now (the oldest), and how many wait behind it. */
    wcPending: queue[0] ?? null,
    wcWaiting: Math.max(0, queue.length - 1),
    wcPairing: pairing,
    wcSessions,
    wcPair,
    wcApproveProposal,
    wcRejectProposal,
    wcApproveRequest,
    wcRejectRequest,
    wcDisconnect,
  };
}
