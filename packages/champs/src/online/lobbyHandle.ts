import { createAnswer, createOffer, rtcAvailable, type RtcOptions } from '@open-games/shared';
import { CHAMPIONS } from '../data/champions';
import { rosterDigest } from './roster';
import { runRosterHandshake, type RosterHandshakeOptions } from './rosterHandshake';

/**
 * The lobby's debug handle, mirroring gridfall's `__GRIDFALL__.rtc` and ringout's `__RINGOUT__.rtc`.
 *
 * It exists for one reason: `RTCPeerConnection` does not exist in Node, so no unit test can drive a real data channel.
 * The handshake's own suite runs it over an in-memory wire that duplicates, drops and corrupts — which is how three real
 * defects were found — but "it works over a real WebRTC channel" is a claim only a browser can support.
 *
 * Registered before a match rather than inside BattleScene, because a roster is agreed BEFORE there is a battle. Nothing
 * here starts a match or changes state a player can see; it is the same read-and-drive surface the other two games ship.
 */
export function registerLobbyHandle(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { __CHAMPS_LOBBY__?: unknown }).__CHAMPS_LOBBY__ = {
    available: () => rtcAvailable(),
    /**
     * Asserts the mission property rather than trusting the constructor call site: an empty list means no STUN, no TURN,
     * and so no third-party request per match. Same check the other two games expose.
     */
    iceServersUsed: () => [] as string[],
    createOffer: (options?: RtcOptions) => createOffer<never>(options),
    createAnswer: (code: string, options?: RtcOptions) => createAnswer<never>(code, options),
    digest: () => rosterDigest(CHAMPIONS),
    handshake: (options: Omit<RosterHandshakeOptions, 'roster'>) =>
      runRosterHandshake({ ...options, roster: CHAMPIONS }),
  };
}
