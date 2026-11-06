// A socket only ever receives the information its seat is allowed to know.
export function visibleCard(card, viewer) {
  if (!card) return null;
  const own = card.controller === viewer;
  const hidden =
    card.location === 1 ||
    (!own &&
      (card.location === 2 ||
        ((card.location === 4 ||
          card.location === 8 ||
          card.location === 32 ||
          card.location === 64) &&
          !(card.position & 5))));
  if (hidden && !card.isPublic)
    return {
      controller: card.controller,
      location: card.location,
      sequence: card.sequence,
      position: card.position,
      uid: card.uid,
      hidden: true,
    };
  return { ...card };
}
export function visibleState(state, viewer) {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      zones: Object.fromEntries(
        Object.entries(player.zones).map(([key, cards]) => [
          key,
          cards.map((card) => visibleCard(card, viewer)),
        ]),
      ),
    })),
  };
}
