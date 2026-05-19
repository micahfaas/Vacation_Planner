// Search deep-links into other travel apps, chosen by place category.
function q(s) { return encodeURIComponent((s || '').trim()); }

function terms(p) {
  return [p.name, p.address].filter(Boolean).join(' ');
}

function bookingUrl(p) {
  return 'https://www.booking.com/searchresults.html?ss=' + q(terms(p));
}
function airbnbUrl(p) {
  return 'https://www.airbnb.com/s/' + q(p.address || p.name) + '/homes';
}
function tripadvisorUrl(p) {
  return 'https://www.tripadvisor.com/Search?q=' + q(terms(p));
}
function getYourGuideUrl(p) {
  return 'https://www.getyourguide.com/s/?q=' + q(p.name || p.address);
}

// Returns [{ label, url, icon, title }] for a place, based on its category.
export function deepLinksFor(p) {
  const out = [];
  const cat = p.category;
  if (cat === 'staying' || cat === 'lodging') {
    out.push({ label: 'Booking', url: bookingUrl(p), icon: 'ti-building', title: 'Search Booking.com for this stay' });
    out.push({ label: 'Airbnb', url: airbnbUrl(p), icon: 'ti-home', title: 'Search Airbnb in this area' });
  }
  if (['restaurant', 'cafe', 'bar', 'cocktail', 'attraction', 'other'].includes(cat)) {
    out.push({ label: 'TripAdvisor', url: tripadvisorUrl(p), icon: 'ti-star', title: 'Look up reviews on TripAdvisor' });
  }
  if (cat === 'attraction') {
    out.push({ label: 'Tours', url: getYourGuideUrl(p), icon: 'ti-ticket', title: 'Find tours & tickets on GetYourGuide' });
  }
  return out;
}
