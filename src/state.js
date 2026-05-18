// Shared mutable app state. Multi-trip: data = { activeTripId, trips: { id: trip } }
// trip = { id, name, startDate, endDate, cards: {}, schedule: {}, library: [], nextId }
// The object reference is never reassigned; modules mutate its properties in place.
export const data = {
  activeTripId: null,
  trips: {}
};

export function activeTrip() { return data.trips[data.activeTripId]; }

// Session-only UI state (not persisted): which view is showing, place filter.
export const ui = { view: 'calendar', placeFilter: 'all' };
