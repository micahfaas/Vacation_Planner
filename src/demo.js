// Demo dataset — a Spain trip (RDM → Madrid → Sevilla → Granada → Madrid).
// Loaded on demand from the Trips menu so the app can be shown off with
// realistic data: every card type, multi-city research, reminders, packing,
// tickets. Each load creates an independent copy that the user can edit,
// share, or delete like any other trip.
import { data } from './state.js';
import { newTripId, markTripDirty, save } from './storage.js';
import { render } from './render.js';
import { getPointsBalances, setPointsBalances } from './profile.js';

const TZ_PDT = 'America/Los_Angeles';
const TZ_ES = 'Europe/Madrid';

function buildDemoTrip() {
  const trip = {
    id: newTripId(),
    name: 'Spain Demo Trip',
    startDate: '2026-08-01',
    endDate: '2026-08-12',
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
    cost: 200,
    notes: 'Horizon Q400 · seat 7A'
  });
  add('2026-08-01', {
    type: 'flight', title: 'IB 6172 SEA → MAD',
    flightNo: 'IB6172',
    originCity: 'Seattle', destCity: 'Madrid',
    originTz: TZ_PDT, destTz: TZ_ES,
    depart: '2026-08-01T16:00', arrive: '2026-08-02T12:30',
    booked: true,
    cost: 1000,
    notes: 'Overnight transatlantic · 10h 30m · seat 24K'
  });

  // ---------- Day 2: Sun Aug 2 — Arrive Madrid (Madrid stay starts) ----------
  add('2026-08-02', {
    type: 'cityStay', title: 'Madrid', city: 'Madrid',
    nights: 3, color: 'slate',
    notes: 'Salamanca district base — easy walk to El Retiro, Las Letras, Sol.'
  });
  add('2026-08-02', {
    type: 'hotel', title: 'Hotel Único Madrid',
    city: 'Madrid', nights: 3, booked: true,
    cost: 750,
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

  // ---------- Day 5: Wed Aug 5 — Madrid → Sevilla (Sevilla stay starts) ----------
  add('2026-08-05', {
    type: 'transit', title: 'AVE Madrid → Sevilla',
    originCity: 'Madrid', destCity: 'Sevilla',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-05T10:00', arrive: '2026-08-05T12:30',
    booked: true,
    cost: 80,
    notes: 'Madrid Atocha → Sevilla Santa Justa · coach 5, seats 1A/1B.'
  });
  add('2026-08-05', {
    type: 'cityStay', title: 'Sevilla', city: 'Sevilla',
    nights: 3, color: 'amber',
    notes: 'Santa Cruz / Alfonso XIII area. Córdoba is a 45-min AVE day trip from here.'
  });
  add('2026-08-05', {
    type: 'hotel', title: 'Hotel Alfonso XIII',
    city: 'Sevilla', nights: 3, booked: true,
    notes: 'Historic luxury · Marriott Luxury Collection · 240k Bonvoy redemption · confirmation AXIII-AUG26'
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
    cost: 30,
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
    booked: true,
    cost: 30
  });

  // ---------- Day 8: Sat Aug 8 — Sevilla → Granada (Granada stay starts) ----------
  add('2026-08-08', {
    type: 'transit', title: 'AVE Sevilla → Granada',
    originCity: 'Sevilla', destCity: 'Granada',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-08T11:00', arrive: '2026-08-08T13:50',
    booked: true,
    cost: 75,
    notes: 'New AVE route via Antequera — 2h 50m.'
  });
  add('2026-08-08', {
    type: 'cityStay', title: 'Granada', city: 'Granada',
    nights: 3, color: 'sage',
    notes: 'Albayzín + Alhambra base. Free tapas with every drink — Granada tradition.'
  });
  add('2026-08-08', {
    type: 'hotel', title: 'Parador de Granada',
    city: 'Granada', nights: 3, booked: true,
    cost: 1200,
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
    type: 'meal', title: 'Bar Aliatar',
    city: 'Granada', time: '20:00',
    notes: 'Free tapa with every drink — Granada tradition still alive here.'
  });

  // ---------- Day 10: Mon Aug 10 — Albayzín + Sacromonte ----------
  add('2026-08-10', {
    type: 'activity', title: 'Carmen de los Mártires gardens',
    city: 'Granada', time: '10:00',
    notes: 'Free romantic gardens near the Alhambra. Peacocks roam.'
  });
  add('2026-08-10', {
    type: 'activity', title: 'Catedral de Granada',
    city: 'Granada', time: '13:00',
    notes: 'Royal Chapel: tombs of Ferdinand & Isabella.'
  });
  add('2026-08-10', {
    type: 'activity', title: 'Sacromonte cave flamenco',
    city: 'Granada', time: '21:00', booked: true,
    notes: 'Zambra performance in a Romani cave.'
  });

  // ---------- Day 11: Tue Aug 11 — Granada → Madrid (return night) ----------
  add('2026-08-11', {
    type: 'transit', title: 'AVE Granada → Madrid',
    originCity: 'Granada', destCity: 'Madrid',
    originTz: TZ_ES, destTz: TZ_ES,
    depart: '2026-08-11T10:00', arrive: '2026-08-11T13:20',
    booked: true,
    cost: 90,
    notes: 'Granada → Atocha · checked-bag-friendly. Cab from Atocha to NH ~10 min.'
  });
  add('2026-08-11', {
    type: 'cityStay', title: 'Madrid', city: 'Madrid',
    nights: 1, color: 'slate',
    notes: 'Return night before flying home — staying near Atocha for the airport run.'
  });
  add('2026-08-11', {
    type: 'hotel', title: 'NH Madrid Atocha',
    city: 'Madrid', nights: 1, booked: true,
    cost: 180,
    notes: 'Quick walk to Atocha · easy Aeropuerto Cercanías to MAD-Barajas.'
  });
  add('2026-08-11', {
    type: 'activity', title: 'Templo de Debod at sunset',
    city: 'Madrid', time: '20:30',
    notes: 'Ancient Egyptian temple — best at sunset.'
  });
  add('2026-08-11', {
    type: 'meal', title: 'Mercado de San Miguel',
    city: 'Madrid', time: '22:00',
    notes: 'Casual dinner crawl — croquetas at El Imparcial, oysters at La Casa del Bacalao.'
  });

  // ---------- Day 12: Wed Aug 12 — Home ----------
  add('2026-08-12', {
    type: 'flight', title: 'IB 6173 MAD → SEA',
    flightNo: 'IB6173',
    originCity: 'Madrid', destCity: 'Seattle',
    originTz: TZ_ES, destTz: TZ_PDT,
    depart: '2026-08-12T15:30', arrive: '2026-08-12T17:30',
    booked: true,
    cost: 950,
    notes: 'Time-zone arithmetic feels weird — you "arrive" before you "left" Madrid in local time.'
  });
  add('2026-08-12', {
    type: 'flight', title: 'AS 2422 SEA → RDM',
    flightNo: 'AS2422',
    originCity: 'Seattle', destCity: 'Redmond',
    originTz: TZ_PDT, destTz: TZ_PDT,
    depart: '2026-08-12T20:00', arrive: '2026-08-12T21:25',
    booked: true,
    cost: 150
  });

  // ---------- Saved places (research) ----------
  function place(p) {
    trip.places.push(Object.assign({ id: crypto.randomUUID() }, p));
  }

  // ----- Where I'm staying (one per city, plus the Aug 11 return night) -----
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
    notes: 'Nights of Aug 8–10 · inside the Alhambra grounds · historic convent'
  });
  place({
    name: 'NH Madrid Atocha', category: 'staying', city: 'Madrid',
    address: 'Paseo Infanta Isabel 9, 28014 Madrid, Spain',
    lat: 40.40545, lng: -3.69013,
    url: 'https://www.google.com/maps/search/?api=1&query=NH+Madrid+Atocha',
    website: 'https://www.nh-hotels.com/en/hotel/nh-madrid-atocha',
    notes: 'Aug 11 return night · steps from Atocha · easy Cercanías to MAD-Barajas'
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

  // ---------- Itinerary drafts (three routes to compare) ----------
  trip.plan.drafts = [
    {
      id: crypto.randomUUID(),
      name: 'Route A — Direct cash',
      stars: 5,
      startDate: '2026-08-01',
      notes: 'Goes north→south then east. Sevilla → Granada is the new direct AVE (~2h 50m via Antequera). Return flight leaves from Madrid, so day 11 is Granada → Madrid by AVE with one overnight near Atocha before the home flight on day 12. This is the chosen plan.',
      returnTransport: { label: 'IB 6173 MAD → SEA · AS 2422 SEA → RDM', cost: 1100, costUnit: 'usd', stars: 4 },
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
          lodging: { label: 'Hotel Alfonso XIII (Marriott Luxury Collection)',
            cost: 240000, costUnit: 'points', pointsProgram: 'Bonvoy', stars: 5,
            url: 'https://www.hotel-alfonsoxiii-seville.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Granada', nights: 3,
          transport: { label: 'AVE Sevilla → Granada (via Antequera)', cost: 75, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Parador de Granada', cost: 1200, costUnit: 'usd', stars: 5,
            url: 'https://www.parador.es/en/paradores/parador-de-granada' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 1,
          transport: { label: 'AVE Granada → Madrid', cost: 90, costUnit: 'usd', stars: 4 },
          lodging: { label: 'NH Madrid Atocha', cost: 180, costUnit: 'usd', stars: 4,
            url: 'https://www.nh-hotels.com/en/hotel/nh-madrid-atocha' }
        }
      ]
    },
    {
      id: crypto.randomUUID(),
      name: 'Route B — Stretch your points',
      stars: 4,
      startDate: '2026-08-01',
      notes: 'Same four stops as Route A but reordered Madrid → Granada → Sevilla → Madrid so Granada (the most demanding) lands while energy is highest. Built to burn points: both Iberia long-haul flights on Avios, both nice hotels on Marriott Bonvoy. Out-of-pocket cash drops by roughly 60% vs Route A — at the cost of award-availability risk on the dates and a longer SVQ → MAD → SEA stretch on the way home.',
      returnTransport: { label: 'IB 6173 MAD → SEA · AS 2422 SEA → RDM',
        cost: 64000, costUnit: 'points', pointsProgram: 'Avios', cashTaxes: 480, stars: 4 },
      stops: [
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 3,
          transport: { label: 'IB 6172 SEA → MAD (overnight)',
            cost: 68000, costUnit: 'points', pointsProgram: 'Avios', cashTaxes: 420, stars: 4 },
          lodging: { label: 'Hotel Único Madrid', cost: 750, costUnit: 'usd', stars: 4,
            url: 'https://www.unicohotelmadrid.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Granada', nights: 3,
          transport: { label: 'AVE Madrid → Granada', cost: 90, costUnit: 'usd', stars: 4 },
          lodging: { label: 'AC Hotel Granada Palacio de Santa Paula (Marriott)',
            cost: 180000, costUnit: 'points', pointsProgram: 'Bonvoy', stars: 5,
            url: 'https://www.marriott.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Sevilla', nights: 3,
          transport: { label: 'AVE Granada → Sevilla (via Antequera)', cost: 75, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Hotel Alfonso XIII (Marriott Luxury Collection)',
            cost: 240000, costUnit: 'points', pointsProgram: 'Bonvoy', stars: 5,
            url: 'https://www.hotel-alfonsoxiii-seville.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 1,
          transport: { label: 'AVE Sevilla → Madrid', cost: 80, costUnit: 'usd', stars: 5 },
          lodging: { label: 'NH Madrid Atocha', cost: 180, costUnit: 'usd', stars: 4,
            url: 'https://www.nh-hotels.com/en/hotel/nh-madrid-atocha' }
        }
      ]
    },
    {
      id: crypto.randomUUID(),
      name: 'Route C — Linger in Madrid',
      stars: 3,
      startDate: '2026-08-01',
      notes: 'Same cities and order as Route A, but the time is distributed differently — four nights in Madrid to settle in, three in Sevilla, only two in Granada. Cheaper 3-leg outbound (RDM → PDX → AMS → MAD) and a Flying Blue redemption on the return to keep cash down.',
      returnTransport: { label: 'KL 1702 MAD → AMS · DL 87 AMS → PDX · AS 2306 PDX → RDM',
        cost: 60000, costUnit: 'points', pointsProgram: 'Flying Blue', cashTaxes: 290, stars: 3 },
      stops: [
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 4,
          transport: { label: 'AS 2305 RDM→PDX · DL 86 PDX→AMS · KL 1701 AMS→MAD', cost: 800, costUnit: 'usd', stars: 2 },
          lodging: { label: 'Hotel Único Madrid', cost: 1000, costUnit: 'usd', stars: 4,
            url: 'https://www.unicohotelmadrid.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Sevilla', nights: 3,
          transport: { label: 'AVE Madrid → Sevilla', cost: 80, costUnit: 'usd', stars: 5 },
          lodging: { label: 'Hotel Alfonso XIII', cost: 1800, costUnit: 'usd', stars: 5,
            url: 'https://www.hotel-alfonsoxiii-seville.com/' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Granada', nights: 2,
          transport: { label: 'AVE Sevilla → Granada (via Antequera)', cost: 75, costUnit: 'usd', stars: 4 },
          lodging: { label: 'Parador de Granada', cost: 800, costUnit: 'usd', stars: 5,
            url: 'https://www.parador.es/en/paradores/parador-de-granada' }
        },
        {
          id: crypto.randomUUID(),
          city: 'Madrid', nights: 1,
          transport: { label: 'AVE Granada → Madrid', cost: 90, costUnit: 'usd', stars: 4 },
          lodging: { label: 'NH Madrid Atocha', cost: 180, costUnit: 'usd', stars: 4,
            url: 'https://www.nh-hotels.com/en/hotel/nh-madrid-atocha' }
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

  // ---------- Journal ----------
  // Pre-written so the demo shows the Journal feature instantly (no API call).
  // One "## Day N" heading per trip day, in order, so the photos below land
  // under the right day.
  trip.journal = {
    markdown: `# Spain — Madrid, Sevilla & Granada
A late-summer loop through the south of Spain: three days in Madrid, the AVE down to Sevilla's orange-scented streets, the Alhambra in Granada, then back to Madrid to fly home. Twelve days and a great deal of tapas.

## Day 1 — Aug 1
Two flights to get here: the early Alaska hop RDM→SEA, then the long Iberia leg into Madrid. Landed late, dropped bags at Hotel Único, and went no further than a quiet first night.

## Day 2 — Aug 2
First full day in Madrid. Wandered El Retiro in the late-afternoon light, then dinner at Casa González — a tiny wine-and-cheese spot that set the tone for the trip.

## Day 3 — Aug 3
Churros and thick chocolate at Chocolatería San Ginés to start, then a long morning in the Prado. Lunch at Casa Lucio for the huevos rotos, and a late dinner at Sobrino de Botín, said to be the oldest restaurant in the world.

## Day 4 — Aug 4
Modern-art morning at the Reina Sofía — Guernica in person is something else. Spent the afternoon grazing the tapas bars of La Latina, with a final Madrid dinner at Lhardy.

## Day 5 — Aug 5
Caught the AVE south to Sevilla — barely two and a half hours and you're in another world. Checked into the Hotel Alfonso XIII, then flamenco at Casa de la Memoria, close enough to feel the floor.

## Day 6 — Aug 6
The Real Alcázar in the morning — tilework and gardens that swallow a couple of hours easily — and the impossibly grand Plaza de España in the afternoon. Dinner at El Rinconcillo, sherry poured the old way.

## Day 7 — Aug 7
A day trip on the AVE to Córdoba for the Mezquita, back to Sevilla by evening. Tired feet, happy.

## Day 8 — Aug 8
AVE across to Granada. The city climbs its hills and the Albaicín is all narrow lanes and viewpoints; settled in for the Alhambra the next morning.

## Day 9 — Aug 9
The Alhambra. Timed entry to the Nasrid Palaces at 10:30 — worth every bit of the early alarm — then the rest of the day just looking back at it from across the valley.

## Day 10 — Aug 10
A slower Granada day, leaning into the local custom of a free tapa with every drink, which is reason enough to keep ordering.

## Day 11 — Aug 11
AVE back up to Madrid for a last night, and one more round of the city's tapas before the early flight.

## Day 12 — Aug 12
Home the way we came: Iberia to Seattle, Alaska back to Redmond.

## Looking back
The AVE made the whole thing feel effortless — three very different cities stitched together in twelve days. Sevilla was the surprise favorite, the Alhambra the high point, and somehow the simplest meals (the San Ginés churros, the La Latina tapas) are the ones that stuck. Next time: more days in Granada.`,
    generatedAt: '2026-08-13T09:00:00.000Z',
    edited: false
  };

  // ---------- Journal photos ----------
  // Bundled, freely-licensed images (see public/demo-photos/CREDITS.md). They
  // use a direct `url` rather than a storage `path`, so they render without a
  // signed-URL fetch.
  const photoUrl = (slug) => import.meta.env.BASE_URL + 'demo-photos/' + slug + '.jpg';
  trip.photos = [
    { id: crypto.randomUUID(), url: photoUrl('madrid-plaza-mayor'), day: '2026-08-02', width: 1000, height: 773, caption: 'Plaza Mayor, Madrid' },
    { id: crypto.randomUUID(), url: photoUrl('madrid-prado'),       day: '2026-08-03', width: 1000, height: 666, caption: 'Museo del Prado, Madrid' },
    { id: crypto.randomUUID(), url: photoUrl('sevilla-alcazar'),    day: '2026-08-06', width: 900,  height: 900, caption: 'Real Alcázar, Sevilla' },
    { id: crypto.randomUUID(), url: photoUrl('sevilla-plaza-espana'), day: '2026-08-06', width: 1000, height: 666, caption: 'Plaza de España, Sevilla' },
    { id: crypto.randomUUID(), url: photoUrl('granada-alhambra'),   day: '2026-08-09', width: 1000, height: 353, caption: 'The Alhambra, Granada' }
  ];

  return trip;
}

// Seed a handful of points/miles balances the first time the demo is loaded
// so the Plan tab's sidebar deltas have something to work against. If the
// user has already entered their own balances we leave them alone so the
// demo never trashes real data.
async function seedDemoBalancesIfEmpty() {
  if (getPointsBalances().length) return;
  try {
    await setPointsBalances([
      { name: 'Avios', balance: 150000 },
      { name: 'Bonvoy', balance: 500000 },
      { name: 'Flying Blue', balance: 80000 },
      { name: 'Amex MR', balance: 200000 },
      { name: 'Capital One', balance: 120000 }
    ]);
  } catch { /* ignored — local cache update still succeeded */ }
}

// Create the demo trip, switch to it, persist + render. Resolves with the
// new trip id so the caller can dismiss any dialog after the work is done.
export function loadDemoTrip() {
  const trip = buildDemoTrip();
  data.trips[trip.id] = trip;
  data.activeTripId = trip.id;
  markTripDirty(trip.id);
  save();
  // Seed balances in the background; the trip render doesn't depend on it,
  // so we don't await. A second render fires once the seeding completes so
  // the Plan sidebar picks the new balances up next time it's opened.
  seedDemoBalancesIfEmpty().then(() => render());
  render();
  return trip.id;
}
