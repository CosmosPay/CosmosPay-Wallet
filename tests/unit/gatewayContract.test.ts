/**
 * Every call the wallet makes to the community server is an operation the server documents,
 * with the same method.
 *
 * The wallet talks to the gateway through hand-written URLs — `${gatewayApi()}/v1/...` in
 * `lib/cosmospay.ts`, the sign-in under `walletApiBase()`, the Pollar bridge and the
 * telemetry feed — and nothing tied them to the server: a renamed route compiled, shipped,
 * and 404'd in every shell at once. This reads those files with the TypeScript compiler and
 * holds each call against `openapi/community-server.json`, which `npm run openapi:check`
 * keeps equal to the server's own spec.
 *
 * Out of reach, deliberately: the SEP-10 / SEP-30 calls in `lib/recovery.ts`. Their URLs
 * come from each recovery server's stellar.toml at runtime — which is the point of them —
 * so there is no literal here to check. The routes themselves are in the spec.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..', '..');
const spec = JSON.parse(readFileSync(path.join(root, 'openapi', 'community-server.json'), 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const normalize = (p: string): string => p.replace(/\{[^}]*\}/g, '{}').replace(/\/+$/, '');

const served = new Set<string>();
for (const [p, methods] of Object.entries(spec.paths)) {
  for (const m of Object.keys(methods)) if (VERBS.has(m)) served.add(`${m.toUpperCase()} ${normalize(p)}`);
}

/** How each base expression reads as a server path prefix. */
const BASES: Record<string, string> = {
  'gatewayApi()': '',
  'walletApiBase()': '/v1/wallet',
  'base()': '/v1/pollar', // lib/pollar.ts
};

/** `${gatewayApi()}/v1/x/${id}` → `/v1/x/{}`, or null when it does not start at a base. */
function serverPath(node: ts.Node): string | null {
  if (!ts.isTemplateExpression(node) || node.head.text !== '') return null;
  const [first, ...rest] = node.templateSpans;
  const prefix = BASES[first.expression.getText()];
  if (prefix === undefined) return null;
  let out = prefix + first.literal.text;
  for (const span of rest) out += `{}${span.literal.text}`;
  return out;
}

/** The first argument, looking through `withQuery(url, …)`. */
function urlArg(call: ts.CallExpression): ts.Node | undefined {
  const arg = call.arguments[0];
  if (arg && ts.isCallExpression(arg) && arg.expression.getText() === 'withQuery') return arg.arguments[0];
  return arg;
}

/** A string-literal method in an options object: `{ method: 'DELETE' }`. */
function methodIn(node: ts.Node | undefined): string | null {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  for (const p of node.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === 'method' && ts.isStringLiteral(p.initializer)) {
      return p.initializer.text.toUpperCase();
    }
  }
  return null;
}

/** The method a transport helper sends. Null for a call that is not a transport. */
function methodOf(call: ts.CallExpression): string | null {
  const callee = call.expression.getText();
  switch (callee) {
    case 'getJson':
    case 'getPlatformJson':
    case 'getPage':
      return 'GET';
    case 'postJson': {
      const m = call.arguments[5];
      return m && ts.isStringLiteral(m) ? m.text : 'POST';
    }
    case 'postEvents':
      return 'POST';
    case 'fetch':
      return methodIn(call.arguments[1]) ?? 'GET';
    default:
      return null;
  }
}

interface Call {
  key: string;
  where: string;
}

const FILES = ['src/lib/cosmospay.ts', 'src/lib/telemetry.ts', 'src/lib/pollar.ts'];

function gatewayCalls(): Call[] {
  const calls: Call[] = [];
  for (const rel of FILES) {
    const sf = ts.createSourceFile(rel, readFileSync(path.join(root, rel), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const where = `${rel}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
        const method = methodOf(node);
        const url = urlArg(node);
        const p = method && url ? serverPath(url) : null;
        if (method && p) calls.push({ key: `${method} ${normalize(p)}`, where });

        // lib/pollar.ts goes through its own `call(method, path, …)`.
        if (rel === 'src/lib/pollar.ts' && node.expression.getText() === 'call') {
          const [m, pathArg] = node.arguments;
          if (m && ts.isStringLiteral(m) && pathArg) {
            const text = ts.isStringLiteral(pathArg) || ts.isNoSubstitutionTemplateLiteral(pathArg)
              ? pathArg.text
              : ts.isTemplateExpression(pathArg)
                ? pathArg.head.text + pathArg.templateSpans.map((s) => `{}${s.literal.text}`).join('')
                : null;
            if (text !== null) calls.push({ key: `${m.text} ${normalize(`/v1/pollar${text}`)}`, where });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return calls;
}

const calls = gatewayCalls();

test('the gateway calls were actually found', () => {
  // A transport renamed out from under this reader would make the check below vacuous.
  assert.ok(calls.length > 40, `found only ${calls.length}`);
});

test('every gateway call is an operation the community server documents, same method', () => {
  const missing = calls.filter((c) => !served.has(c.key)).map((c) => `${c.key}  (${c.where})`);
  assert.deepEqual(missing, []);
});

test('the recovery routes the wallet reaches through stellar.toml are in the contract', () => {
  // Built at runtime from each server's TOML, so checked by name rather than by call site.
  for (const key of [
    'GET /.well-known/stellar.toml',
    'GET /v1/sep10/auth',
    'POST /v1/sep10/auth',
    'POST /v1/sep30/identity',
    'POST /v1/sep30/identity/email/start',
    'POST /v1/sep30/identity/email/verify',
    'GET /v1/sep30/accounts',
    'POST /v1/sep30/accounts/{}',
    'PUT /v1/sep30/accounts/{}',
    'GET /v1/sep30/accounts/{}',
    'DELETE /v1/sep30/accounts/{}',
    'POST /v1/sep30/accounts/{}/sign/{}',
  ]) {
    assert.ok(served.has(key), key);
  }
});
