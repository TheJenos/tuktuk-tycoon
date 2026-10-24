/*
 * The net layer: one GameSession for offline play (createLocalSession) and online rooms (RoomConnection.session()).
 * Nothing here loads Firebase until onlineDb() / openFirebaseDb() is called.
 */

export type * from './types';
export { MemoryDb, MemoryServer, onlineAvailable, onlineDb, openFirebaseDb, type Db, type TransactResult } from './db';
export { applyEnvelope, createDoc, decodeDoc, encodeDoc, othersPlaying, seatsOf, verifyNext, type Verify } from './doc';
export { CODE_CHARS, discordPlayerId, discordRoomCode, inviteCode, isPlayerId, playerId, randomId } from './ids';
export { Session, type SessionOptions, type StateRecord } from './session';
export { clearSoloSave, createLocalSession, hasSoloSave, LOCAL_PLAYER, type LocalOptions, type LocalSeat } from './local';
export {
  DEFAULT_ROOM_RULES,
  RoomConnection,
  RoomError,
  rematchSeats,
  roomConfig,
  roomInUse,
  toRoomRules,
  watchRooms,
  type ClosedReason,
  type CreateRoomOptions,
  type JoinOptions,
  type LobbyRecord,
  type PresenceRecord,
  type RoomHandlers,
  type RoomRules,
  type RoomStatus,
  type RoomSummary,
  type SetupRecord,
} from './network';
export { forgetRoom, freeRoomPlayerId, pidInUse, rememberedPid, rememberRoom, roomPlayerId, savedSeats, tabRoom } from './rejoin';
