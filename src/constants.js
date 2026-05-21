// Card type registry and storage key.
export const TYPES = {
  cityStay: { label: 'City stay', icon: 'ti-map-pin',         color: '#5a6e96', bg: '#dde3f0', text: '#2c3a55' }, // slate (default; per-card color override via CITY_STAY_COLORS)
  flight:   { label: 'Flight',    icon: 'ti-plane',           color: '#1f7fb5', bg: '#dff0fa', text: '#0e4366' }, // sky blue
  hotel:    { label: 'Hotel',     icon: 'ti-bed',             color: '#c7549f', bg: '#fce5f0', text: '#7a2a5d' }, // hibiscus pink
  activity: { label: 'Activity',  icon: 'ti-camera',          color: '#2da55a', bg: '#dff5e6', text: '#1a5e34' }, // palm green
  transit:  { label: 'Transit',   icon: 'ti-bus',             color: '#e8821e', bg: '#fce6c6', text: '#7d4509' }, // sunset orange
  meal:     { label: 'Meal',      icon: 'ti-tools-kitchen-2', color: '#d94d3a', bg: '#fce0db', text: '#7a261a' }, // coral red
  note:     { label: 'Note',      icon: 'ti-note',            color: '#a88a4f', bg: '#f4ead2', text: '#5e4a23' }  // sandy tan
};

// Named palette for city-stay cards. The editor offers these as preset chips
// and the renderer looks up bg/text/color when card.color is set.
export const CITY_STAY_COLORS = {
  slate:    { color: '#5a6e96', bg: '#dde3f0', text: '#2c3a55' },
  amber:    { color: '#8a6b30', bg: '#f0d8a8', text: '#5a4416' },
  sage:     { color: '#4f6e44', bg: '#cfdfc7', text: '#2c4326' },
  rose:     { color: '#8c4a5a', bg: '#e8c5cd', text: '#5a2c38' },
  lavender: { color: '#5d4d80', bg: '#d5cce8', text: '#382b54' }
};

export const STORAGE_KEY = 'vacation_planner_v1';

// Categories for the research / places library.
export const PLACE_CATEGORIES = {
  staying:    { label: "Where I'm staying", icon: 'ti-home' },
  restaurant: { label: 'Restaurant', icon: 'ti-tools-kitchen-2' },
  cafe:       { label: 'Café',       icon: 'ti-coffee' },
  bar:        { label: 'Bar',        icon: 'ti-glass-full' },
  cocktail:   { label: 'Cocktail bar', icon: 'ti-glass-cocktail' },
  attraction: { label: 'Attraction', icon: 'ti-camera' },
  shop:       { label: 'Shopping',   icon: 'ti-shopping-bag' },
  lodging:    { label: 'Lodging',    icon: 'ti-bed' },
  other:      { label: 'Other',      icon: 'ti-map-pin' }
};
