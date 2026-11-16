/**
 * LibSodium's crypto_box_seal in pure TypeScript (no native module: Expo Go has no libsodium), for the Open Cloud
 * secrets store, which wants each secret sealed against the universe's public key.
 *
 *   sealed = ephemeralPk || crypto_box(message, nonce, recipientPk, ephemeralSk)
 *   nonce  = BLAKE2b-192(ephemeralPk || recipientPk)
 *   crypto_box = X25519 shared point -> HSalsa20 key -> XSalsa20 stream + Poly1305 tag ("easy" layout: tag || ciphertext)
 *
 * X25519, Salsa20 / HSalsa20 / XSalsa20 and Poly1305 are ported from the public-domain TweetNaCl (Bernstein et al.;
 * the 17-byte-limb Poly1305 of the C original); BLAKE2b follows RFC 7693 with 64-bit words as pairs of 32-bit halves
 * (no BigInt). The module is pure: randomness comes from the caller (expo-crypto getRandomBytes in the app), so it
 * runs the same in node, where it is checked against node:crypto, Python's cryptography and the system libsodium.
 */

// Bytes ---------------------------------------------------------------------------------------------------------------

export function utf8(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
	let out = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i];
		const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
		const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
		const n = (a << 16) | (b << 8) | c;
		out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
	}
	return out;
}

/** Standard or URL-safe base64, padding optional. Throws on anything else. */
export function fromBase64(text: string): Uint8Array {
	const clean = text.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
	if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new Error("not base64");
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
	let bits = 0;
	let acc = 0;
	let o = 0;
	for (const ch of clean) {
		acc = (acc << 6) | B64.indexOf(ch);
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[o++] = (acc >>> bits) & 0xff;
		}
	}
	return out;
}

// X25519 (TweetNaCl gf arithmetic: 16 limbs of 16 bits in a Float64Array) ---------------------------------------------

type GF = Float64Array;

function gf(init?: number[]): GF {
	const r = new Float64Array(16);
	if (init) for (let i = 0; i < init.length; i++) r[i] = init[i];
	return r;
}

const GF_121665 = gf([0xdb41, 1]);
const BASE_POINT = (() => {
	const b = new Uint8Array(32);
	b[0] = 9;
	return b;
})();

function car25519(o: GF) {
	let c = 1;
	for (let i = 0; i < 16; i++) {
		const v = o[i] + c + 65535;
		c = Math.floor(v / 65536);
		o[i] = v - c * 65536;
	}
	o[0] += c - 1 + 37 * (c - 1);
}

function sel25519(p: GF, q: GF, b: number) {
	const c = ~(b - 1);
	for (let i = 0; i < 16; i++) {
		const t = c & (p[i] ^ q[i]);
		p[i] ^= t;
		q[i] ^= t;
	}
}

function pack25519(o: Uint8Array, n: GF) {
	const m = gf();
	const t = gf();
	for (let i = 0; i < 16; i++) t[i] = n[i];
	car25519(t);
	car25519(t);
	car25519(t);
	for (let j = 0; j < 2; j++) {
		m[0] = t[0] - 0xffed;
		for (let i = 1; i < 15; i++) {
			m[i] = t[i] - 0xffff - ((m[i - 1] >> 16) & 1);
			m[i - 1] &= 0xffff;
		}
		m[15] = t[15] - 0x7fff - ((m[14] >> 16) & 1);
		const b = (m[15] >> 16) & 1;
		m[14] &= 0xffff;
		sel25519(t, m, 1 - b);
	}
	for (let i = 0; i < 16; i++) {
		o[2 * i] = t[i] & 0xff;
		o[2 * i + 1] = t[i] >> 8;
	}
}

function unpack25519(o: GF, n: Uint8Array) {
	for (let i = 0; i < 16; i++) o[i] = n[2 * i] + (n[2 * i + 1] << 8);
	o[15] &= 0x7fff;
}

function fadd(o: GF, a: GF, b: GF) {
	for (let i = 0; i < 16; i++) o[i] = a[i] + b[i];
}

function fsub(o: GF, a: GF, b: GF) {
	for (let i = 0; i < 16; i++) o[i] = a[i] - b[i];
}

function fmul(o: GF, a: GF, b: GF) {
	const t = new Float64Array(31);
	for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) t[i + j] += a[i] * b[j];
	for (let i = 0; i < 15; i++) t[i] += 38 * t[i + 16];
	for (let i = 0; i < 16; i++) o[i] = t[i];
	car25519(o);
	car25519(o);
}

function fsq(o: GF, a: GF) {
	fmul(o, a, a);
}

function inv25519(o: GF, i: GF) {
	const c = gf();
	for (let a = 0; a < 16; a++) c[a] = i[a];
	for (let a = 253; a >= 0; a--) {
		fsq(c, c);
		if (a !== 2 && a !== 4) fmul(c, c, i);
	}
	for (let a = 0; a < 16; a++) o[a] = c[a];
}

/** X25519(n, p): the 32-byte shared point (crypto_scalarmult). */
export function scalarMult(n: Uint8Array, p: Uint8Array): Uint8Array {
	if (n.length !== 32 || p.length !== 32) throw new Error("X25519 needs 32-byte inputs");
	const q = new Uint8Array(32);
	const z = new Uint8Array(32);
	const x = new Float64Array(80);
	const a = gf();
	const b = gf();
	const c = gf();
	const d = gf();
	const e = gf();
	const f = gf();
	for (let i = 0; i < 31; i++) z[i] = n[i];
	z[31] = (n[31] & 127) | 64;
	z[0] &= 248;
	unpack25519(x, p);
	for (let i = 0; i < 16; i++) {
		b[i] = x[i];
		d[i] = a[i] = c[i] = 0;
	}
	a[0] = d[0] = 1;
	for (let i = 254; i >= 0; --i) {
		const r = (z[i >>> 3] >>> (i & 7)) & 1;
		sel25519(a, b, r);
		sel25519(c, d, r);
		fadd(e, a, c);
		fsub(a, a, c);
		fadd(c, b, d);
		fsub(b, b, d);
		fsq(d, e);
		fsq(f, a);
		fmul(a, c, a);
		fmul(c, b, e);
		fadd(e, a, c);
		fsub(a, a, c);
		fsq(b, a);
		fsub(c, d, f);
		fmul(a, c, GF_121665);
		fadd(a, a, d);
		fmul(c, c, a);
		fmul(a, d, f);
		fmul(d, b, x);
		fsq(b, e);
		sel25519(a, b, r);
		sel25519(c, d, r);
	}
	for (let i = 0; i < 16; i++) {
		x[i + 16] = a[i];
		x[i + 32] = c[i];
		x[i + 48] = b[i];
		x[i + 64] = d[i];
	}
	const x32 = x.subarray(32);
	const x16 = x.subarray(16);
	inv25519(x32, x32);
	fmul(x16, x16, x32);
	pack25519(q, x16);
	return q;
}

/** The X25519 public key of a 32-byte secret key. */
export function publicKeyOf(secretKey: Uint8Array): Uint8Array {
	return scalarMult(secretKey, BASE_POINT);
}

// Salsa20 family -------------------------------------------------------------------------------------------------------

const SIGMA = utf8("expand 32-byte k");

function ld32(x: Uint8Array, i: number): number {
	return (x[i] | (x[i + 1] << 8) | (x[i + 2] << 16) | (x[i + 3] << 24)) >>> 0;
}

function st32(x: Uint8Array, j: number, u: number) {
	for (let i = 0; i < 4; i++) {
		x[j + i] = u & 255;
		u >>>= 8;
	}
}

function rotl(x: number, c: number): number {
	return (x << c) | (x >>> (32 - c));
}

/** TweetNaCl's core: Salsa20 (64-byte block) or, with `h`, HSalsa20 (32-byte key). */
function core(out: Uint8Array, inp: Uint8Array, k: Uint8Array, c: Uint8Array, h: boolean) {
	const w = new Uint32Array(16);
	const x = new Uint32Array(16);
	const y = new Uint32Array(16);
	const t = new Uint32Array(4);
	for (let i = 0; i < 4; i++) {
		x[5 * i] = ld32(c, 4 * i);
		x[1 + i] = ld32(k, 4 * i);
		x[6 + i] = ld32(inp, 4 * i);
		x[11 + i] = ld32(k, 16 + 4 * i);
	}
	for (let i = 0; i < 16; i++) y[i] = x[i];
	for (let i = 0; i < 20; i++) {
		for (let j = 0; j < 4; j++) {
			for (let m = 0; m < 4; m++) t[m] = x[(5 * j + 4 * m) % 16];
			t[1] ^= rotl((t[0] + t[3]) | 0, 7);
			t[2] ^= rotl((t[1] + t[0]) | 0, 9);
			t[3] ^= rotl((t[2] + t[1]) | 0, 13);
			t[0] ^= rotl((t[3] + t[2]) | 0, 18);
			for (let m = 0; m < 4; m++) w[4 * j + ((j + m) % 4)] = t[m];
		}
		for (let m = 0; m < 16; m++) x[m] = w[m];
	}
	if (h) {
		for (let i = 0; i < 16; i++) x[i] = (x[i] + y[i]) | 0;
		for (let i = 0; i < 4; i++) {
			x[5 * i] = (x[5 * i] - ld32(c, 4 * i)) | 0;
			x[6 + i] = (x[6 + i] - ld32(inp, 4 * i)) | 0;
		}
		for (let i = 0; i < 4; i++) {
			st32(out, 4 * i, x[5 * i]);
			st32(out, 16 + 4 * i, x[6 + i]);
		}
	} else {
		for (let i = 0; i < 16; i++) st32(out, 4 * i, (x[i] + y[i]) | 0);
	}
}

/** HSalsa20(key, 16-byte input) -> 32-byte subkey (crypto_core_hsalsa20). */
export function hsalsa(key: Uint8Array, input: Uint8Array): Uint8Array {
	const out = new Uint8Array(32);
	core(out, input, key, SIGMA, true);
	return out;
}

/** Salsa20 with an 8-byte nonce: message XOR keystream (crypto_stream_salsa20_xor). */
function salsa20Xor(message: Uint8Array, nonce8: Uint8Array, key: Uint8Array): Uint8Array {
	const out = new Uint8Array(message.length);
	const z = new Uint8Array(16);
	const block = new Uint8Array(64);
	for (let i = 0; i < 8; i++) z[i] = nonce8[i];
	for (let pos = 0; pos < message.length; pos += 64) {
		core(block, z, key, SIGMA, false);
		const n = Math.min(64, message.length - pos);
		for (let i = 0; i < n; i++) out[pos + i] = message[pos + i] ^ block[i];
		let u = 1;
		for (let i = 8; i < 16; i++) {
			u += z[i];
			z[i] = u & 0xff;
			u >>>= 8;
		}
	}
	return out;
}

/** XSalsa20 with a 24-byte nonce: message XOR keystream (crypto_stream_xsalsa20_xor). */
export function xsalsa20Xor(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
	if (nonce.length !== 24 || key.length !== 32) throw new Error("XSalsa20 needs a 24-byte nonce and a 32-byte key");
	const subkey = hsalsa(key, nonce.subarray(0, 16));
	return salsa20Xor(message, nonce.subarray(16, 24), subkey);
}

// Poly1305 (TweetNaCl C original: 17 limbs of 8 bits) ------------------------------------------------------------------

const MINUS_P = [5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 252];

function add1305(h: number[], c: number[]) {
	let u = 0;
	for (let j = 0; j < 17; j++) {
		u += h[j] + c[j];
		h[j] = u & 255;
		u >>>= 8;
	}
}

/** Poly1305 tag of `message` under a 32-byte one-time key (crypto_onetimeauth). */
export function poly1305(message: Uint8Array, key: Uint8Array): Uint8Array {
	if (key.length !== 32) throw new Error("Poly1305 needs a 32-byte key");
	const r = new Array<number>(17).fill(0);
	const h = new Array<number>(17).fill(0);
	const c = new Array<number>(17).fill(0);
	const x = new Array<number>(17).fill(0);
	for (let j = 0; j < 16; j++) r[j] = key[j];
	r[3] &= 15;
	r[4] &= 252;
	r[7] &= 15;
	r[8] &= 252;
	r[11] &= 15;
	r[12] &= 252;
	r[15] &= 15;
	let pos = 0;
	let n = message.length;
	while (n > 0) {
		c.fill(0);
		let j = 0;
		for (; j < 16 && j < n; ++j) c[j] = message[pos + j];
		c[j] = 1;
		pos += j;
		n -= j;
		add1305(h, c);
		for (let i = 0; i < 17; i++) {
			x[i] = 0;
			for (let k = 0; k < 17; k++) x[i] += h[k] * (k <= i ? r[i - k] : 320 * r[i + 17 - k]);
		}
		for (let i = 0; i < 17; i++) h[i] = x[i];
		let u = 0;
		for (let k = 0; k < 16; k++) {
			u += h[k];
			h[k] = u & 255;
			u = Math.floor(u / 256);
		}
		u += h[16];
		h[16] = u & 3;
		u = 5 * Math.floor(u / 4);
		for (let k = 0; k < 16; k++) {
			u += h[k];
			h[k] = u & 255;
			u = Math.floor(u / 256);
		}
		u += h[16];
		h[16] = u;
	}
	const g = h.slice();
	add1305(h, MINUS_P);
	const s = -(h[16] >> 7);
	for (let j = 0; j < 17; j++) h[j] ^= s & (g[j] ^ h[j]);
	for (let j = 0; j < 16; j++) c[j] = key[j + 16];
	c[16] = 0;
	add1305(h, c);
	const out = new Uint8Array(16);
	for (let j = 0; j < 16; j++) out[j] = h[j];
	return out;
}

// BLAKE2b (RFC 7693; 64-bit words as [lo, hi] pairs of a Uint32Array) -------------------------------------------------

const BLAKE2B_IV32 = new Uint32Array([
	0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a, 0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab,
	0x137e2179, 0x5be0cd19,
]);

const SIGMA8 = [
	0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3, 11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4, 7, 9, 3, 1, 13, 12, 11, 14,
	2, 6, 5, 10, 4, 0, 15, 8, 9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13, 2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9, 12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8,
	11, 13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10, 6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5, 10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0, 0, 1, 2, 3, 4, 5,
	6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3,
];
/** SIGMA8 as offsets into the [lo, hi] message words. */
const SIGMA82 = SIGMA8.map((s) => s * 2);

/** v[a] += v[b] (64-bit, on [lo, hi] pairs). */
function add64aa(v: Uint32Array, a: number, b: number) {
	const o0 = v[a] + v[b];
	let o1 = v[a + 1] + v[b + 1];
	if (o0 >= 0x100000000) o1++;
	v[a] = o0;
	v[a + 1] = o1;
}

/** v[a] += (b1 << 32 | b0). */
function add64ac(v: Uint32Array, a: number, b0: number, b1: number) {
	const o0 = v[a] + b0;
	let o1 = v[a + 1] + b1;
	if (o0 >= 0x100000000) o1++;
	v[a] = o0;
	v[a + 1] = o1;
}

function blake2bCompress(h: Uint32Array, block: Uint8Array, t: number, last: boolean) {
	const v = new Uint32Array(32);
	const m = new Uint32Array(32);
	for (let i = 0; i < 16; i++) {
		v[i] = h[i];
		v[i + 16] = BLAKE2B_IV32[i];
	}
	v[24] ^= t;
	v[25] ^= Math.floor(t / 0x100000000);
	if (last) {
		v[28] = ~v[28];
		v[29] = ~v[29];
	}
	for (let i = 0; i < 32; i++) m[i] = ld32(block, 4 * i);
	const g = (a: number, b: number, c: number, d: number, ix: number, iy: number) => {
		const x0 = m[ix];
		const x1 = m[ix + 1];
		const y0 = m[iy];
		const y1 = m[iy + 1];
		add64aa(v, a, b);
		add64ac(v, a, x0, x1);
		// d = rotr64(d ^ a, 32)
		let xor0 = v[d] ^ v[a];
		let xor1 = v[d + 1] ^ v[a + 1];
		v[d] = xor1;
		v[d + 1] = xor0;
		add64aa(v, c, d);
		// b = rotr64(b ^ c, 24)
		xor0 = v[b] ^ v[c];
		xor1 = v[b + 1] ^ v[c + 1];
		v[b] = (xor0 >>> 24) ^ (xor1 << 8);
		v[b + 1] = (xor1 >>> 24) ^ (xor0 << 8);
		add64aa(v, a, b);
		add64ac(v, a, y0, y1);
		// d = rotr64(d ^ a, 16)
		xor0 = v[d] ^ v[a];
		xor1 = v[d + 1] ^ v[a + 1];
		v[d] = (xor0 >>> 16) ^ (xor1 << 16);
		v[d + 1] = (xor1 >>> 16) ^ (xor0 << 16);
		add64aa(v, c, d);
		// b = rotr64(b ^ c, 63)
		xor0 = v[b] ^ v[c];
		xor1 = v[b + 1] ^ v[c + 1];
		v[b] = (xor1 >>> 31) ^ (xor0 << 1);
		v[b + 1] = (xor0 >>> 31) ^ (xor1 << 1);
	};
	for (let i = 0; i < 12; i++) {
		const s = i * 16;
		g(0, 8, 16, 24, SIGMA82[s + 0], SIGMA82[s + 1]);
		g(2, 10, 18, 26, SIGMA82[s + 2], SIGMA82[s + 3]);
		g(4, 12, 20, 28, SIGMA82[s + 4], SIGMA82[s + 5]);
		g(6, 14, 22, 30, SIGMA82[s + 6], SIGMA82[s + 7]);
		g(0, 10, 20, 30, SIGMA82[s + 8], SIGMA82[s + 9]);
		g(2, 12, 22, 24, SIGMA82[s + 10], SIGMA82[s + 11]);
		g(4, 14, 16, 26, SIGMA82[s + 12], SIGMA82[s + 13]);
		g(6, 8, 18, 28, SIGMA82[s + 14], SIGMA82[s + 15]);
	}
	for (let i = 0; i < 16; i++) h[i] = h[i] ^ v[i] ^ v[i + 16];
}

/** Unkeyed BLAKE2b with a 1-64 byte digest. */
export function blake2b(input: Uint8Array, outLength = 64): Uint8Array {
	if (!Number.isInteger(outLength) || outLength < 1 || outLength > 64) throw new Error("BLAKE2b digest length must be 1-64");
	const h = new Uint32Array(BLAKE2B_IV32);
	h[0] ^= 0x01010000 ^ outLength;
	const block = new Uint8Array(128);
	let t = 0;
	let pos = 0;
	// Every full block but the last is compressed as it fills; the last (possibly partial or empty) one is final.
	while (input.length - pos > 128) {
		block.set(input.subarray(pos, pos + 128));
		t += 128;
		blake2bCompress(h, block, t, false);
		pos += 128;
	}
	block.fill(0);
	block.set(input.subarray(pos));
	t += input.length - pos;
	blake2bCompress(h, block, t, true);
	const out = new Uint8Array(outLength);
	for (let i = 0; i < outLength; i++) out[i] = (h[i >> 2] >>> (8 * (i & 3))) & 0xff;
	return out;
}

// crypto_box / crypto_box_seal ------------------------------------------------------------------------------------------

const ZERO16 = new Uint8Array(16);

/** crypto_box_beforenm: HSalsa20(X25519(sk, pk), 0). */
function boxKey(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
	return hsalsa(scalarMult(secretKey, publicKey), ZERO16);
}

/** crypto_secretbox_easy: tag(16) || ciphertext. */
function secretboxEasy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array {
	const padded = new Uint8Array(32 + message.length);
	padded.set(message, 32);
	const stream = xsalsa20Xor(padded, nonce, key);
	const ciphertext = stream.subarray(32);
	const tag = poly1305(ciphertext, stream.subarray(0, 32));
	const out = new Uint8Array(16 + message.length);
	out.set(tag, 0);
	out.set(ciphertext, 16);
	return out;
}

function secretboxOpenEasy(box: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array | null {
	if (box.length < 16) return null;
	const padded = new Uint8Array(32 + box.length - 16);
	padded.set(box.subarray(16), 32);
	const polyKey = xsalsa20Xor(new Uint8Array(32), nonce, key);
	const tag = poly1305(box.subarray(16), polyKey);
	let diff = 0;
	for (let i = 0; i < 16; i++) diff |= tag[i] ^ box[i];
	if (diff !== 0) return null;
	return xsalsa20Xor(padded, nonce, key).subarray(32);
}

function sealNonce(ephemeralPk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
	const both = new Uint8Array(64);
	both.set(ephemeralPk, 0);
	both.set(recipientPk, 32);
	return blake2b(both, 24);
}

export const SEAL_OVERHEAD = 48;

/**
 * crypto_box_seal: an anonymous sealed box (ephemeralPk || box) only the holder of `recipientPk`'s secret key can
 * open. `randomBytes` supplies the 32-byte ephemeral secret key (expo-crypto getRandomBytes in the app); it is wiped
 * after use.
 */
export function cryptoBoxSeal(message: Uint8Array, recipientPk: Uint8Array, randomBytes: (n: number) => Uint8Array): Uint8Array {
	if (recipientPk.length !== 32) throw new Error(`the public key must be 32 bytes (got ${recipientPk.length})`);
	const esk = randomBytes(32);
	if (!(esk instanceof Uint8Array) || esk.length !== 32) throw new Error("no random bytes");
	try {
		const epk = publicKeyOf(esk);
		const box = secretboxEasy(message, sealNonce(epk, recipientPk), boxKey(recipientPk, esk));
		const out = new Uint8Array(32 + box.length);
		out.set(epk, 0);
		out.set(box, 32);
		return out;
	} finally {
		esk.fill(0);
	}
}

/** crypto_box_seal_open: the message, or null when the box is not for this key pair or was altered. */
export function cryptoBoxSealOpen(sealed: Uint8Array, recipientPk: Uint8Array, recipientSk: Uint8Array): Uint8Array | null {
	if (sealed.length < SEAL_OVERHEAD) return null;
	const epk = sealed.subarray(0, 32);
	return secretboxOpenEasy(sealed.subarray(32), sealNonce(epk, recipientPk), boxKey(epk, recipientSk));
}
