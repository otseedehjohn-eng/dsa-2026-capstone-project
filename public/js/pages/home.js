import { listEvents } from '../api.js';
import { el, formatEventDate, formatPrice, getErrorMessage } from '../ui.js';

const form = document.querySelector('#filters');
const eventList = document.querySelector('#event-list');
const resultsStatus = document.querySelector('#results-status');

function eventCard(event) {
  const prices = event.tiers.map(({ priceCents }) => priceCents);
  const startingPrice = prices.length > 0 ? Math.min(...prices) : null;
  const seatsLeft = event.tiers.reduce((sum, tier) => sum + tier.seatsLeft, 0);

  return el('article', { className: 'event-card' }, [
    el('div', { className: 'event-card-topline' }, [
      el('span', { className: 'event-city' }, event.city),
      el('span', { className: 'event-date' }, formatEventDate(event.date)),
    ]),
    el('h3', { className: 'event-title' }, [
      el('a', { href: `/event.html?id=${encodeURIComponent(event.id)}` }, event.title),
    ]),
    el('p', { className: 'event-venue' }, event.venue),
    el('div', { className: 'event-card-footer' }, [
      el('p', { className: 'starting-price' }, [
        el('span', { className: 'muted-label' }, 'From'),
        startingPrice === null ? 'No tickets listed' : formatPrice(startingPrice),
      ]),
      el('span', {
        className: seatsLeft > 0 ? 'availability' : 'availability sold-out',
      }, seatsLeft > 0 ? `${seatsLeft} tickets left` : 'Sold out'),
    ]),
  ]);
}

async function showEvents(criteria = {}) {
  resultsStatus.textContent = 'Finding events…';
  eventList.replaceChildren();

  try {
    const events = await listEvents(criteria);
    if (events.length === 0) {
      resultsStatus.textContent = 'No events match those filters. Try changing your search.';
      return;
    }

    eventList.replaceChildren(...events.map(eventCard));
    resultsStatus.textContent = `${events.length} ${events.length === 1 ? 'event' : 'events'} to explore`;
  } catch (error) {
    resultsStatus.textContent = getErrorMessage(error);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const maxPriceValue = formData.get('maxPriceCents');
  const maxPriceCents = maxPriceValue === '' ? undefined : Number(maxPriceValue);

  if (maxPriceCents !== undefined && (!Number.isSafeInteger(maxPriceCents) || maxPriceCents < 0)) {
    resultsStatus.textContent = 'Enter a maximum price as a non-negative whole number of cents.';
    return;
  }

  showEvents({
    q: formData.get('q'),
    city: formData.get('city'),
    maxPriceCents,
    sort: formData.get('sort'),
  });
});

showEvents();
