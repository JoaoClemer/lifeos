// Autenticador de software para os testes: gera uma chave P-256 e monta as respostas do WebAuthn
// (cadastro com atestado "none" e login com assinatura ECDSA), como um celular faria.
const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) (out.set(p, i), (i += p.length));
  return out;
}

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));

/** CBOR mínimo: inteiros, bytes, texto e mapas (o suficiente para COSE e attestationObject). */
function cbor(value: unknown): Uint8Array {
  const head = (major: number, n: number) =>
    n < 24
      ? Uint8Array.of((major << 5) | n)
      : n < 256
        ? Uint8Array.of((major << 5) | 24, n)
        : Uint8Array.of((major << 5) | 25, n >> 8, n & 255);
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const b = enc.encode(value);
    return concat(head(3, b.length), b);
  }
  if (value instanceof Uint8Array) return concat(head(2, value.length), value);
  if (value instanceof Map) return concat(head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)]));
  throw new Error("tipo CBOR não suportado");
}

/** Assinatura ECDSA crua (r||s) para DER, como os autenticadores enviam. */
function derSignature(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    const v = b.slice(i);
    return v[0] & 0x80 ? concat(Uint8Array.of(0), v) : v;
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  const body = concat(Uint8Array.of(2, r.length), r, Uint8Array.of(2, s.length), s);
  return concat(Uint8Array.of(0x30, body.length), body);
}

interface CreationOptions {
  challenge: string;
  rp: { id?: string };
}
interface RequestOptions {
  challenge: string;
  rpId?: string;
}

export class SoftAuthenticator {
  private counter = 0;
  private constructor(
    private keys: CryptoKeyPair,
    readonly credentialId: Uint8Array,
  ) {}

  static async create(): Promise<SoftAuthenticator> {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
    return new SoftAuthenticator(keys, crypto.getRandomValues(new Uint8Array(16)));
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  /** Resposta de cadastro (navigator.credentials.create). */
  async register(options: CreationOptions, origin = "http://localhost") {
    const clientData = enc.encode(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
    const jwk = (await crypto.subtle.exportKey("jwk", this.keys.publicKey)) as JsonWebKey;
    const cose = cbor(
      new Map<number, unknown>([
        [1, 2], // EC2
        [3, -7], // ES256
        [-1, 1], // P-256
        [-2, fromB64url(jwk.x!)],
        [-3, fromB64url(jwk.y!)],
      ]),
    );
    const authData = concat(
      await sha256(enc.encode(options.rp.id ?? "localhost")),
      Uint8Array.of(0x45), // presença + verificação do usuário + dados da credencial
      new Uint8Array(4), // contador 0
      new Uint8Array(16), // aaguid
      Uint8Array.of(this.credentialId.length >> 8, this.credentialId.length & 255),
      this.credentialId,
      cose,
    );
    const attestation = cbor(
      new Map<string, unknown>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", authData],
      ]),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestation), transports: ["internal"] },
      clientExtensionResults: {},
    };
  }

  /** Resposta de login (navigator.credentials.get). */
  async login(options: RequestOptions, origin = "http://localhost") {
    this.counter++;
    const clientData = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
    const authData = concat(
      await sha256(enc.encode(options.rpId ?? "localhost")),
      Uint8Array.of(0x05), // presença + verificação do usuário
      Uint8Array.of(0, 0, this.counter >> 8, this.counter & 255),
    );
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.keys.privateKey, concat(authData, await sha256(clientData))),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(derSignature(raw)) },
      clientExtensionResults: {},
    };
  }
}
