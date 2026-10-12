/**
 * Which past meetings Ask Roxi may search on this turn.
 *
 * meeting_history.db holds every account's meetings on this Mac; each row
 * carries the `account_id` that recorded it. The Rust host sends the scope
 * with every Ask (`commands/chat.rs::scope_json`):
 *   {kind:'everyone'}                 local-only mode, no accounts
 *   {kind:'account', accountId:'…'}   signed in
 *   {kind:'nobody'}                   accounts on, nobody signed in
 *
 * Resolved here, once per turn, into the form the graph carries:
 *   {all: true,  ids: []}      search everything
 *   {all: false, ids: [1, 2]}  search only these meetings (possibly none)
 * Never null, because graph channels ignore null updates and a thread would
 * then keep the previous turn's scope.
 */

'use strict';

const EVERYONE = Object.freeze({ all: true, ids: [] });
const NOTHING = Object.freeze({ all: false, ids: [] });

/**
 * @param {{kind?: string, accountId?: string}|undefined|null} scope
 * @param {{meetingIdsOwnedBy: (accountId: string) => number[]}} store
 * @returns {{all: boolean, ids: number[]}}
 */
function resolveMeetingScope(scope, store) {
  // A host that predates accounts sends no scope; it also has no accounts.
  if (!scope || scope.kind === 'everyone') return EVERYONE;
  if (scope.kind === 'account' && typeof scope.accountId === 'string' && scope.accountId.trim()) {
    return { all: false, ids: store.meetingIdsOwnedBy(scope.accountId.trim()) };
  }
  // 'nobody', or anything unrecognised: fail closed.
  return NOTHING;
}

/**
 * The retrieval-layer form: null = unrestricted, array = only these ids.
 * @param {{all: boolean, ids: number[]}|undefined} meetingScope
 * @returns {number[]|null}
 */
function allowedMeetingIds(meetingScope) {
  if (!meetingScope || meetingScope.all) return null;
  return meetingScope.ids;
}

module.exports = { resolveMeetingScope, allowedMeetingIds, EVERYONE, NOTHING };
