export const mockEvents = [
  {
    id: 'lagos-tech-meetup',
    title: 'The Future of Lagos Tech',
    city: 'Lagos',
    venue: 'Landmark Centre',
    date: '2026-12-05T17:00:00Z',
    published: true,
    tiers: [
      {
        id: 'lagos-tech-general',
        name: 'General admission',
        priceCents: 250000,
        capacity: 80,
        sold: 18,
        seatsLeft: 62,
      },
      {
        id: 'lagos-tech-vip',
        name: 'VIP',
        priceCents: 450000,
        capacity: 20,
        sold: 20,
        seatsLeft: 0,
      },
    ],
  },
  {
    id: 'abuja-jazz-night',
    title: 'Abuja Jazz Night',
    city: 'Abuja',
    venue: 'Arts Pavilion',
    date: '2026-12-19T19:30:00Z',
    published: true,
    tiers: [
      {
        id: 'abuja-jazz-standard',
        name: 'Standard',
        priceCents: 180000,
        capacity: 80,
        sold: 78,
        seatsLeft: 2,
      },
      {
        id: 'abuja-jazz-front-row',
        name: 'Front row',
        priceCents: 400000,
        capacity: 10,
        sold: 0,
        seatsLeft: 10,
      },
    ],
  },
  {
    id: 'lagos-food-festival',
    title: 'Lagos Street Food Festival',
    city: 'Lagos',
    venue: 'Muri Okunola Park',
    date: '2027-01-16T12:00:00Z',
    published: true,
    tiers: [
      {
        id: 'lagos-food-entry',
        name: 'Festival entry',
        priceCents: 75000,
        capacity: 120,
        sold: 120,
        seatsLeft: 0,
      },
    ],
  },
  {
    id: 'draft-event',
    title: 'A private draft',
    city: 'Lagos',
    venue: 'Backstage',
    date: '2027-02-01T10:00:00Z',
    published: false,
    tiers: [{ id: 'draft-tier', name: 'Entry', priceCents: 10000, capacity: 5, sold: 0, seatsLeft: 5 }],
  },
];

export const mockBookings = [];
