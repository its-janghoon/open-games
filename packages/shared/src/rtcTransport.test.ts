import { describe, expect, it } from 'vitest';

import { decodeSignal, encodeSignal, participantFor, rtcAvailable } from './rtcTransport';

/** A host-candidate-only offer, close enough in shape and repetitiveness to a real one. */
const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:aBcD',
  'a=ice-pwd:0123456789abcdef0123456789',
  'a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=candidate:1 1 udp 2122260223 192.168.1.42 51820 typ host generation 0',
  'a=candidate:2 1 udp 2122194687 10.0.0.7 51821 typ host generation 0',
  '',
].join('\r\n');

describe('signal codes', () => {
  it('round-trips an offer', async () => {
    const code = await encodeSignal({ type: 'offer', sdp: SDP });
    expect(await decodeSignal(code)).toEqual({ type: 'offer', sdp: SDP });
  });

  it('round-trips an answer', async () => {
    const code = await encodeSignal({ type: 'answer', sdp: SDP });
    expect(await decodeSignal(code)).toEqual({ type: 'answer', sdp: SDP });
  });

  it('is meaningfully shorter than the SDP a player would otherwise copy', async () => {
    /**
     * The reason for gzipping at all. An SDP is repetitive text and the code is something a human copies between two
     * machines, so it has to be as short as the format allows. This pins that the compression is actually doing work —
     * a change that quietly dropped it would still round-trip and still pass every other test here.
     */
    const code = await encodeSignal({ type: 'offer', sdp: SDP });
    expect(code.length).toBeLessThan(SDP.length);
  });

  it('survives whitespace a copy-paste introduces', async () => {
    // Codes get pasted through chat apps and terminals, which wrap lines. Losing a match to a line break would be a
    // bad reason to lose a match.
    const code = await encodeSignal({ type: 'offer', sdp: SDP });
    const mangled = `  ${code.slice(0, 20)}\n${code.slice(20, 60)}\r\n  ${code.slice(60)}  `;
    expect(await decodeSignal(mangled)).toEqual({ type: 'offer', sdp: SDP });
  });

  it('refuses a string that is not a connection code, naming what it wanted', async () => {
    // A mistyped or half-copied code is the EXPECTED failure here, so the message has to be readable rather than a
    // stack trace about base64.
    await expect(decodeSignal('hello')).rejects.toThrow(/Open Games connection code/);
    await expect(decodeSignal('')).rejects.toThrow(/Open Games connection code/);
  });

  it('refuses a code with the right prefix but damaged content', async () => {
    await expect(decodeSignal('OG1:not-real-base64-@@@')).rejects.toThrow(/damaged/);
  });

  it('refuses a well-formed code that does not describe a connection', async () => {
    // Distinct from "damaged": this decompresses and parses cleanly but is the wrong thing.
    const bogus = await encodeSignal({ type: 'offer', sdp: SDP });
    const payload = JSON.stringify({ type: 'greeting', sdp: 'hi' });
    const bytes = new TextEncoder().encode(payload);
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
    const gz = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (const byte of gz) binary += String.fromCharCode(byte);
    const code = `OG1:${btoa(binary)}`;
    expect(code).not.toBe(bogus);
    await expect(decodeSignal(code)).rejects.toThrow(/does not describe a connection/);
  });
});

describe('roles', () => {
  it('gives the offerer p1 and the answerer p2', () => {
    /**
     * Fixed rather than negotiated, and the contrast with the BroadcastChannel transport is the point: that one needed
     * an id comparison because both tabs were identical and first-come left BOTH as p2. Here exactly one peer produces
     * the offer, so there is no symmetry to break.
     */
    expect(participantFor('offerer')).toBe('p1');
    expect(participantFor('answerer')).toBe('p2');
  });
});

describe('availability', () => {
  it('reports honestly that Node cannot do this', () => {
    // Node has no RTCPeerConnection, so a caller must be able to find that out and offer the local game instead of
    // presenting a connect screen that can never work.
    expect(rtcAvailable()).toBe(false);
  });
});
