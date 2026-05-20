// Demo dataset — a 10-day Spain trip (RDM → Madrid → Sevilla → Granada).
// Loaded on demand from the Trips menu so the app can be shown off with
// realistic data: every card type, multi-city research, reminders, packing,
// tickets. Each load creates an independent copy that the user can edit,
// share, or delete like any other trip.
import { data } from './state.js';
import { newTripId, markTripDirty, save } from './storage.js';
import { render } from './render.js';

const TZ_PDT = 'America/Los_Angeles';
const TZ_ES = 'Europe/Madrid';

function buildDemoTrip() {
  const trip = {
    id: newTripId(),
    name: '10 days in Spain — demo',
    startDate: '2026-08-01',
    endDate: '2026-08-10',
    cards: {},
    schedule: {},
    library: [],
    libFilter: 'all',
    nextId: 1,
    places: [],
    plan: { drafts: [] },
    resources: { links: [], tickets: [] },
    reminders: [],
    packing: []
  };

  function add(date, card) {
    const id = 'c' + trip.nextId++;
    trip.cards[id] = Object.assign({ id }, card);
    if (date) {
      trip.schedule[date] = trip.schedule[date] || [];
      trip.schedule[date].push(id);
    } else {
      trip.library.push(id);
    }
  }

  // ---------- Day 1: Sat Aug 1 — RDM → SEA → MAD ----------
  add('2026-08-01', {
    type: 'flight', title: 'AS 2415 RDM → SEA',
    flightNo: 'AS2415',
    originCity: 'Redmond', destCity: 'Seattle',
    originTz: TZ_PDT, destTz: TZ_PDT,
    depart: '2026-08-01T10:30', arrive: '2026-08-01T11:50',
    booked: true,
    notes: 'Horizon Q400 · seat 7A'
  });
  add('2026-08-01', {
    type: 'flight', title: 'IB 6172 SEA → MAD',
    flightNo: 'IB6172',
    originCity: 'Seattle', destCity: 'Madrid',
    originTz: TZ_PDT, destTz: TZ_ES,
    depart: '2026-08-01T16:00', arrive: '2026-08-02T12:30',
    booked: true,
    notes: 'Overnight transatlantic · 10h 30m · seat 24K'
  });

  // ---------- Day 2: Sun Aug 2 — Arrive Madrid ----------
  add('2026-08-02', {
    type: 'hotel', title: 'Hotel Único Madrid',
    city: 'Madrid', nights: 3, booked: true,
    notes: 'Salamanca district · confirmation HU-2026-08AUG'
  });
  add('2026-08-02', {
    type: 'activity', title: 'El Retiro Park stroll',
    city: 'Madrid', time: '17:00',
    notes: 'Easy walk to shake off jet lag — Crystal Palace, rowboats, gardens.'
  });
  add('2026-08-02', {
    type: 'meal', title: 'Casa González',
    city: 'Madrid', time: '20:30',
    notes: 'Tapas + Spanish wine flight. C. del León 12, Las Letras.'
  });

  // ---------- Day 3: Mon Aug 3 — Madrid ----------
  add('2026-08-03', {
    type: 'meal', title: 'Chocolatería San Ginés',
    city: 'Madrid', time: '08:30',
    notes: 'Churros con chocolate — open since 1894.'
  });
  add('2026-08-03', {
    type: 'activity', title: 'Museo del Prado',
    city: 'Madrid', time: '10:00', booked: true,
    notes: 'Velázquez, Goya, El Greco. Timed entry — see Tickets.'
  });
  add('2026-08-03', {
    type: 'meal', title: 'Casa Lucio',
    city: 'Madrid', time: '14:00',
    notes: 'Huevos rotos (broken eggs over potatoes). Cava Baja 35.'
  });
  add('2026-08-03', {
    type: 'meal', title: 'Sobrino de Botín',
    city: 'Madrid', time: '21:00', booked: true,
    notes: "World's oldest restaurant (1725). Cochinillo asado."
  });

  // ---------- Day 4: Tue Aug 4 — Madrid ----------
  add('2026-08-04', {
    type: 'activity', title: 'Reina Sofía',
    city: 'Madrid', time: '10:00', booked: true,
    notes: "Picasso's Guernica. Timed entry — see Tickets."
  });
  add('2026-08-04', {
    type: 'activity', title: 'La Latina tapas crawl',
    city: 'Madrid', time: '13:00',
    notes: 'Cava Baja street — multiple stops, no reservations.'
  });
  add('2026-08-04', {
    type: 'meal', title: 'Lhardy',
    city: 'Madrid', time: '21:00',
    notes: 'Historic restaurant from 1839. Cocido madrileño on Tuesdays.'
  });

  // ---------- Day 5: Wed Aug 5 — Madrid → Sevilla ----------
  add('2026-08-05', {
    type: 'transit', title: 'AVE Madrid → Sevilla',
    originCity: 'Madrid', destCity: 'Sevilla',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-05T10:00', arrive: '2026-08-05T12:30',
    booked: true,
    notes: 'Madrid Atocha → Sevilla Santa Justa · coach 5, seats 1A/1B.'
  });
  add('2026-08-05', {
    type: 'hotel', title: 'Hotel Alfonso XIII',
    city: 'Sevilla', nights: 3, booked: true,
    notes: 'Historic luxury · confirmation AXIII-AUG26'
  });
  add('2026-08-05', {
    type: 'activity', title: 'Flamenco at Casa de la Memoria',
    city: 'Sevilla', time: '21:00', booked: true,
    notes: 'Intimate venue — pre-booked, see Tickets.'
  });

  // ---------- Day 6: Thu Aug 6 — Sevilla ----------
  add('2026-08-06', {
    type: 'activity', title: 'Real Alcázar',
    city: 'Sevilla', time: '09:30', booked: true,
    notes: 'Mudéjar palace + gardens. Game of Thrones filming site.'
  });
  add('2026-08-06', {
    type: 'meal', title: 'El Rinconcillo',
    city: 'Sevilla', time: '13:30',
    notes: "Sevilla's oldest tapas bar (1670). Spinach with chickpeas."
  });
  add('2026-08-06', {
    type: 'activity', title: 'Sevilla Cathedral & La Giralda',
    city: 'Sevilla', time: '15:30',
    notes: 'Largest Gothic cathedral. Climb La Giralda for views.'
  });
  add('2026-08-06', {
    type: 'activity', title: 'Setas de Sevilla at sunset',
    city: 'Sevilla', time: '20:30',
    notes: 'Metropol Parasol rooftop walkway — sunset views.'
  });

  // ---------- Day 7: Fri Aug 7 — Day trip to Córdoba ----------
  add('2026-08-07', {
    type: 'transit', title: 'AVE Sevilla → Córdoba',
    originCity: 'Sevilla', destCity: 'Córdoba',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-07T08:15', arrive: '2026-08-07T09:00',
    booked: true,
    notes: '45 minutes each way.'
  });
  add('2026-08-07', {
    type: 'activity', title: 'Mezquita-Catedral de Córdoba',
    city: 'Córdoba', time: '09:30', booked: true,
    notes: 'Mosque-cathedral — the iconic red-and-white arches.'
  });
  add('2026-08-07', {
    type: 'activity', title: 'Judería walk',
    city: 'Córdoba', time: '12:00',
    notes: 'Jewish quarter — narrow streets, flower-lined patios.'
  });
  add('2026-08-07', {
    type: 'transit', title: 'AVE Córdoba → Sevilla',
    originCity: 'Córdoba', destCity: 'Sevilla',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-07T18:30', arrive: '2026-08-07T19:15',
    booked: true
  });

  // ---------- Day 8: Sat Aug 8 — Sevilla → Granada ----------
  add('2026-08-08', {
    type: 'transit', title: 'AVE Sevilla → Granada',
    originCity: 'Sevilla', destCity: 'Granada',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-08T11:00', arrive: '2026-08-08T13:50',
    booked: true,
    notes: 'New AVE route via Antequera — 2h 50m.'
  });
  add('2026-08-08', {
    type: 'hotel', title: 'Parador de Granada',
    city: 'Granada', nights: 2, booked: true,
    notes: 'Inside the Alhambra grounds — historic convent.'
  });
  add('2026-08-08', {
    type: 'activity', title: 'Mirador de San Nicolás at sunset',
    city: 'Granada', time: '20:00',
    notes: 'Iconic Alhambra view from the Albayzín hill.'
  });

  // ---------- Day 9: Sun Aug 9 — Alhambra ----------
  add('2026-08-09', {
    type: 'activity', title: 'Alhambra — Nasrid Palaces',
    city: 'Granada', time: '10:30', booked: true,
    notes: "Strict timed entry — don't be late. See Tickets."
  });
  add('2026-08-09', {
    type: 'activity', title: 'Generalife gardens',
    city: 'Granada', time: '12:30',
    notes: 'Summer palace + gardens — included with Alhambra ticket.'
  });
  add('2026-08-09', {
    type: 'activity', title: 'Sacromonte cave flamenco',
    city: 'Granada', time: '21:00', booked: true,
    notes: 'Zambra performance in a Romani cave.'
  });

  // ---------- Day 10: Mon Aug 10 — Home ----------
  add('2026-08-10', {
    type: 'transit', title: 'AVE Granada → Madrid',
    originCity: 'Granada', destCity: 'Madrid',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-10T07:30', arrive: '2026-08-10T10:50',
    booked: true,
    notes: 'Granada → Atocha · Metro to MAD-Barajas takes ~30 min.'
  });
  add('2026-08-10', {
    type: 'flight', title: 'IB 6173 MAD → SEA',
    flightNo: 'IB6173',
    originCity: 'Madrid', destCity: 'Seattle',
    originTz: TZ_ES, destTz: TZ_PDT,
    depart: '2026-08-10T15:30', arrive: '2026-08-10T17:30',
    booked: true,
    notes: 'Time-zone arithmetic feels weird — you "arrive" before you "left" Madrid in local time.'
  });
  add('2026-08-10', {
    type: 'flight', title: 'AS 2422 SEA → RDM',
    flightNo: 'AS2422',
    originCity: 'Seattle', destCity: 'Redmond',
    originTz: TZ_PDT, destTz: TZ_PDT,
    depart: '2026-08-10T20:00', arrive: '2026-08-10T21:25',
    booked: true
  });

  // ---------- Saved places (research) ----------
  function place(p) {
    trip.places.push(Object.assign({ id: crypto.randomUUID() }, p));
  }

  // ----- Where I'm staying (one per city) -----
  place({
    name: 'Hotel Único Madrid', category: 'staying', city: 'Madrid',
    address: 'Calle de Claudio Coello 67, 28001 Madrid, Spain',
    lat: 40.42820, lng: -3.68400,
    url: 'https://www.google.com/maps/search/?api=1&query=Hotel+Unico+Madrid',
    website: 'https://www.unicohotelmadrid.com/',
    notes: 'Nights of Aug 2–4 · Salamanca district · confirmation HU-2026-08AUG'
  });
  place({
    name: 'Hotel Alfonso XIII', category: 'staying', city: 'Sevilla',
    address: 'Calle San Fernando 2, 41004 Sevilla, Spain',
    lat: 37.38290, lng: -5.99290,
    url: 'https://www.google.com/maps/search/?api=1&query=Hotel+Alfonso+XIII+Sevilla',
    website: 'https://www.hotel-alfonsoxiii-seville.com/',
    notes: 'Nights of Aug 5–7 · historic luxury · confirmation AXIII-AUG26'
  });
  place({
    name: 'Parador de Granada', category: 'staying', city: 'Granada',
    address: 'Calle Real de la Alhambra s/n, 18009 Granada, Spain',
    lat: 37.17810, lng: -3.58760,
    url: 'https://www.google.com/maps/search/?api=1&query=Parador+de+Granada',
    website: 'https://www.parador.es/en/paradores/parador-de-granada',
    notes: 'Nights of Aug 8–9 · inside the Alhambra grounds · historic convent'
  });

  // Madrid
  place({
    name: 'Mercado de San Miguel', category: 'restaurant', city: 'Madrid',
    address: 'Plaza de San Miguel, 28005 Madrid, Spain',
    lat: 40.41535, lng: -3.70923,
    url: 'https://www.google.com/maps/search/?api=1&query=Mercado+de+San+Miguel+Madrid',
    website: 'https://www.mercadodesanmiguel.es/',
    notes: 'Iconic food market just off Plaza Mayor. Croquetas at El Imparcial stall.'
  });
  place({
    name: 'Templo de Debod', category: 'attraction', city: 'Madrid',
    address: 'Calle de Ferraz 1, 28008 Madrid, Spain',
    lat: 40.42434, lng: -3.71778,
    url: 'https://www.google.com/maps/search/?api=1&query=Templo+de+Debod+Madrid',
    notes: 'Ancient Egyptian temple — best at sunset.'
  });
  place({
    name: 'El Rastro flea market', category: 'shop', city: 'Madrid',
    address: 'Calle de la Ribera de Curtidores, Madrid, Spain',
    lat: 40.40869, lng: -3.70846,
    url: 'https://www.google.com/maps/search/?api=1&query=El+Rastro+Madrid',
    notes: 'Sundays only, 9am–3pm. Bring small bills.'
  });
  place({
    name: 'Café del Príncipe', category: 'cafe', city: 'Madrid',
    address: 'Plaza Canalejas 5, 28014 Madrid, Spain',
    lat: 40.41703, lng: -3.70113,
    url: 'https://www.google.com/maps/search/?api=1&query=Cafe+del+Principe+Madrid',
    notes: 'Quiet old-school café off Puerta del Sol.'
  });

  // Sevilla
  place({
    name: 'Casa de Pilatos', category: 'attraction', city: 'Sevilla',
    address: 'Plaza de Pilatos 1, 41003 Sevilla, Spain',
    lat: 37.38929, lng: -5.98712,
    url: 'https://www.google.com/maps/search/?api=1&query=Casa+de+Pilatos+Sevilla',
    notes: 'Mudéjar palace, smaller and quieter than the Alcázar.'
  });
  place({
    name: 'Eslava', category: 'restaurant', city: 'Sevilla',
    address: 'Calle Eslava 3, 41002 Sevilla, Spain',
    lat: 37.39989, lng: -5.99662,
    url: 'https://www.google.com/maps/search/?api=1&query=Eslava+Sevilla',
    website: 'https://www.espacioeslava.com/',
    notes: 'Award-winning yolk on caramelized boletus toast.'
  });
  place({
    name: 'Bar El Comercio', category: 'cafe', city: 'Sevilla',
    address: 'Calle Lineros 9, 41004 Sevilla, Spain',
    lat: 37.38943, lng: -5.99052,
    url: 'https://www.google.com/maps/search/?api=1&query=Bar+El+Comercio+Sevilla',
    notes: 'Best churros in town. Tiled walls from 1904.'
  });
  place({
    name: 'Hospital de los Venerables', category: 'attraction', city: 'Sevilla',
    address: 'Plaza de los Venerables 8, 41004 Sevilla, Spain',
    lat: 37.38553, lng: -5.99117,
    url: 'https://www.google.com/maps/search/?api=1&query=Hospital+de+los+Venerables+Sevilla',
    notes: 'Baroque hospital with Velázquez paintings in Santa Cruz.'
  });

  // Granada
  place({
    name: 'Carmen de los Mártires', category: 'attraction', city: 'Granada',
    address: 'Paseo de los Mártires, 18009 Granada, Spain',
    lat: 37.17382, lng: -3.59446,
    url: 'https://www.google.com/maps/search/?api=1&query=Carmen+de+los+Martires+Granada',
    notes: 'Free romantic gardens near the Alhambra. Peacocks roam.'
  });
  place({
    name: 'La Tetería del Bañuelo', category: 'cafe', city: 'Granada',
    address: 'Carrera del Darro 39, 18010 Granada, Spain',
    lat: 37.17873, lng: -3.59194,
    url: 'https://www.google.com/maps/search/?api=1&query=Teteria+del+Banuelo+Granada',
    notes: 'Moroccan-style teahouse in the Albayzín.'
  });
  place({
    name: 'Bar Aliatar', category: 'bar', city: 'Granada',
    address: 'Plaza de Aliatar, 18010 Granada, Spain',
    lat: 37.18001, lng: -3.58968,
    url: 'https://www.google.com/maps/search/?api=1&query=Bar+Aliatar+Granada',
    notes: 'Free tapa with every drink — local tradition still alive here.'
  });
  place({
    name: 'Catedral de Granada', category: 'attraction', city: 'Granada',
    address: 'Calle Gran Vía de Colón 5, 18001 Granada, Spain',
    lat: 37.17679, lng: -3.59854,
    url: 'https://www.google.com/maps/search/?api=1&query=Catedral+de+Granada',
    notes: 'Royal Chapel: tombs of Ferdinand & Isabella.'
  });

  // ---------- Itinerary drafts (two routes to compare) ----------
  trip.plan.drafts = [
    {
      id: crypto.randomUUID(),
      name: 'Route A — Madrid → Sevilla → Granada',
      stars: 5,
      startDate: '2026-08-01',
      notes: 'Goes north→south then east. Sevilla → Granada is the new direct AVE (~2h 50m via Antequera). Return flight leaves from Madrid, so day 10 is Granada → Madrid by AVE in the morning then home. This is the chosen plan.',
      stops: [
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 3,
          transport: { label: 'IB 6172 SEA → MAD (overnight)', cost: 1200, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Hotel Único Madrid', cost: 750, costUnit: 'usd', stars: 4,
            url: 'https://www.unicohotelmadrid.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Sevilla', nights: 3,
          transport: { label: 'AVE Madrid → Sevilla', cost: 80, costUnit: 'usd', stars: 5 },
          lodging: { label: 'Hotel Alfonso XIII', cost: 1200, costUnit: 'usd', stars: 5,
            url: 'https://www.hotel-alfonsoxiii-seville.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Granada', nights: 2,
          transport: { label: 'AVE Sevilla → Granada (via Antequera)', cost: 75, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Parador de Granada', cost: 800, costUnit: 'usd', stars: 5,
            url: 'https://www.parador.es/en/paradores/parador-de-granada' }
        }
      ]
    },
    {
      id: crypto.randomUUID(),
      name: 'Route C — Same as A, cheaper multi-leg flights',
      stars: 3,
      startDate: '2026-08-01',
      notes: 'Identical ground itinerary to Route A, but swaps the single overnight SEA → MAD flight for a longer 3-leg path: RDM → PDX → AMS → MAD outbound, MAD → AMS → SEA → RDM home. Saves roughly $400 round-trip but adds ~9 hours of total travel and two extra layovers. Better as a backup if direct Iberia award space is closed.',
      stops: [
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 3,
          transport: { label: 'AS 2305 RDM→PDX · DL 86 PDX→AMS · KL 1701 AMS→MAD', cost: 800, costUnit: 'usd', stars: 2 },
          lodging: { label: 'Hotel Único Madrid', cost: 750, costUnit: 'usd', stars: 4,
            url: 'https://www.unicohotelmadrid.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Sevilla', nights: 3,
          transport: { label: 'AVE Madrid → Sevilla', cost: 80, costUnit: 'usd', stars: 5 },
          lodging: { label: 'Hotel Alfonso XIII', cost: 1200, costUnit: 'usd', stars: 5,
            url: 'https://www.hotel-alfonsoxiii-seville.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Granada', nights: 2,
          transport: { label: 'AVE Sevilla → Granada (via Antequera)', cost: 75, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Parador de Granada', cost: 800, costUnit: 'usd', stars: 5,
            url: 'https://www.parador.es/en/paradores/parador-de-granada' }
        }
      ]
    },
    {
      id: crypto.randomUUID(),
      name: 'Route B — Madrid → Granada → Sevilla',
      stars: 3,
      startDate: '2026-08-01',
      notes: 'Visits Granada earlier when energy is highest (Alhambra is a lot). Sevilla last means flying home via SVQ → MAD on day 10, which adds one extra short flight vs. Route A. Trade-off: ends with hotter, lower-key Sevilla evenings instead of Granada views.',
      stops: [
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 3,
          transport: { label: 'IB 6172 SEA → MAD (overnight)', cost: 1200, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Hotel Único Madrid', cost: 750, costUnit: 'usd', stars: 4,
            url: 'https://www.unicohotelmadrid.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Granada', nights: 3,
          transport: { label: 'AVE Madrid → Granada', cost: 90, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Parador de Granada', cost: 1200, costUnit: 'usd', stars: 5,
            url: 'https://www.parador.es/en/paradores/parador-de-granada' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Sevilla', nights: 2,
          transport: { label: 'AVE Granada → Sevilla (via Antequera)', cost: 75, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Hotel Alfonso XIII', cost: 800, costUnit: 'usd', stars: 5,
            url: 'https://www.hotel-alfonsoxiii-seville.com/' }
        }
      ]
    }
  ];

  // ---------- Resources ----------
  trip.resources.links = [
    {
      id: crypto.randomUUID(),
      title: 'Renfe — Spain rail',
      url: 'https://www.renfe.com/',
      location: 'Spain',
      notes: 'AVE high-speed bookings open ~3 months out.'
    },
    {
      id: crypto.randomUUID(),
      title: 'Alhambra tickets — official site',
      url: 'https://tickets.alhambra-patronato.es/',
      location: 'Granada',
      notes: 'Nasrid Palaces sell out weeks ahead in August.'
    },
    {
      id: crypto.randomUUID(),
      title: 'Madrid Barajas airport guide',
      url: 'https://www.aena.es/en/madrid-barajas.html',
      location: 'Madrid',
      notes: 'Terminal 4 for Iberia. Metro line 8 to city centre.'
    }
  ];
  trip.resources.tickets = [
    {
      id: crypto.randomUUID(),
      title: 'Alhambra — Nasrid Palaces (Aug 9, 10:30)',
      location: 'Granada',
      accessNote: 'Email confirmation · reference ALH-26-08-9876',
      notes: 'Bring passport — they spot-check IDs.',
      attachments: []
    },
    {
      id: crypto.randomUUID(),
      title: 'Prado Museum (Aug 3, 10:00)',
      location: 'Madrid',
      accessNote: 'On phone · reference PR-26-08-1133',
      notes: '',
      attachments: []
    },
    {
      id: crypto.randomUUID(),
      title: 'Reina Sofía (Aug 4, 10:00)',
      location: 'Madrid',
      accessNote: 'On phone · reference RS-26-08-5588',
      notes: '',
      attachments: []
    }
  ];

  // ---------- Reminders ----------
  trip.reminders = [
    { id: crypto.randomUUID(), text: 'Notify bank of international travel', dueDate: '2026-07-25', done: false },
    { id: crypto.randomUUID(), text: 'Download offline Google Maps for Madrid / Sevilla / Granada', dueDate: '2026-07-29', done: false },
    { id: crypto.randomUUID(), text: 'Confirm Alhambra timed entry', dueDate: '2026-07-15', done: true }
  ];

  // ---------- Packing ----------
  trip.packing = [
    { id: crypto.randomUUID(), text: 'Passport', packed: false },
    { id: crypto.randomUUID(), text: 'EU plug adapter (Type C/F)', packed: false },
    { id: crypto.randomUUID(), text: 'Comfortable walking shoes', packed: false },
    { id: crypto.randomUUID(), text: 'Light layers — Spanish nights cool down', packed: false },
    { id: crypto.randomUUID(), text: 'Sunscreen & hat — August sun', packed: false },
    { id: crypto.randomUUID(), text: 'Phone + charger', packed: true }
  ];

  return trip;
}

// Create the demo trip, switch to it, persist + render. Resolves with the
// new trip id so the caller can dismiss any dialog after the work is done.
export function loadDemoTrip() {
  const trip = buildDemoTrip();
  data.trips[trip.id] = trip;
  data.activeTripId = trip.id;
  markTripDirty(trip.id);
  save();
  render();
  return trip.id;
}
