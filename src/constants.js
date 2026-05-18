// Card type registry and storage key.
export const TYPES = {
  flight:   { label: 'Flight',    icon: 'ti-plane',           color: '#1f7fb5', bg: '#dff0fa', text: '#0e4366' }, // sky blue
  hotel:    { label: 'Hotel',     icon: 'ti-bed',             color: '#c7549f', bg: '#fce5f0', text: '#7a2a5d' }, // hibiscus pink
  activity: { label: 'Activity',  icon: 'ti-camera',          color: '#2da55a', bg: '#dff5e6', text: '#1a5e34' }, // palm green
  transit:  { label: 'Transit',   icon: 'ti-bus',             color: '#e8821e', bg: '#fce6c6', text: '#7d4509' }, // sunset orange
  meal:     { label: 'Meal',      icon: 'ti-tools-kitchen-2', color: '#d94d3a', bg: '#fce0db', text: '#7a261a' }, // coral red
  note:     { label: 'Note',      icon: 'ti-note',            color: '#a88a4f', bg: '#f4ead2', text: '#5e4a23' }  // sandy tan
};

export const STORAGE_KEY = 'vacation_planner_v1';

// Categories for the research / places library.
export const PLACE_CATEGORIES = {
  restaurant: { label: 'Restaurant', icon: 'ti-tools-kitchen-2' },
  cafe:       { label: 'Café',       icon: 'ti-coffee' },
  bar:        { label: 'Bar',        icon: 'ti-glass-full' },
  attraction: { label: 'Attraction', icon: 'ti-camera' },
  shop:       { label: 'Shopping',   icon: 'ti-shopping-bag' },
  lodging:    { label: 'Lodging',    icon: 'ti-bed' },
  blog:       { label: 'Blog / guide', icon: 'ti-article' },
  other:      { label: 'Other',      icon: 'ti-map-pin' }
};
