import { DomainError } from './errors.js';
import { mergeSort } from './sorting.js';

function validation(message) {
  throw new DomainError('VALIDATION', message);
}

function parseIsoDate(value, label) {
  if (typeof value !== 'string') {
    validation(`${label} must be an ISO date string.`);
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const date = new Date(timestamp);
    if (
      date.getUTCFullYear() !== Number(year)
      || date.getUTCMonth() + 1 !== Number(month)
      || date.getUTCDate() !== Number(day)
    ) {
      validation(`${label} must be a real ISO date.`);
    }
    return timestamp;
  }

  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    validation(`${label} must be a valid ISO date or datetime.`);
  }

  return Date.parse(value);
}

function getTierPrices(event) {
  if (!Array.isArray(event.tiers)) {
    validation('Event tiers must be an array.');
  }
  return event.tiers.map((tier) => {
    if (!Number.isSafeInteger(tier.priceCents) || tier.priceCents < 0) {
      validation('Tier prices must be non-negative whole numbers of cents.');
    }
    return tier.priceCents;
  });
}

function availableSeats(event) {
  if (!Array.isArray(event.tiers)) {
    validation('Event tiers must be an array.');
  }
  return event.tiers.reduce((total, tier) => {
    if (!Number.isSafeInteger(tier.seatsLeft) || tier.seatsLeft < 0) {
      validation('Tier seatsLeft must be a non-negative whole number.');
    }
    return total + tier.seatsLeft;
  }, 0);
}

function normalizeText(value, label) {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    validation(`${label} must be a string.`);
  }
  return value.trim().toLocaleLowerCase();
}

export function filterEvents(summaries, {
  q,
  city,
  from,
  to,
  maxPriceCents,
  onlyAvailable = false,
} = {}) {
  if (!Array.isArray(summaries)) {
    validation('Event summaries must be an array.');
  }
  if (onlyAvailable !== undefined && typeof onlyAvailable !== 'boolean') {
    validation('onlyAvailable must be a boolean.');
  }

  const query = normalizeText(q, 'Search query');
  const requestedCity = normalizeText(city, 'City');
  const lowerBound = from === undefined ? undefined : parseIsoDate(from, 'from');
  let upperBound = to === undefined ? undefined : parseIsoDate(to, 'to');

  if (to !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    upperBound += 86_400_000 - 1;
  }

  if (maxPriceCents !== undefined && (!Number.isSafeInteger(maxPriceCents) || maxPriceCents < 0)) {
    validation('Maximum price must be a non-negative whole number of cents.');
  }

  return summaries.filter((event) => {
    if (query && !`${event.title} ${event.venue}`.toLocaleLowerCase().includes(query)) {
      return false;
    }
    if (requestedCity && normalizeText(event.city, 'Event city') !== requestedCity) {
      return false;
    }

    if (lowerBound !== undefined || upperBound !== undefined) {
      const eventDate = parseIsoDate(event.date, 'Event date');
      if (lowerBound !== undefined && eventDate < lowerBound) {
        return false;
      }
      if (upperBound !== undefined && eventDate > upperBound) {
        return false;
      }
    }

    if (maxPriceCents !== undefined) {
      const prices = getTierPrices(event);
      if (prices.length === 0 || Math.min(...prices) > maxPriceCents) {
        return false;
      }
    }

    return !onlyAvailable || availableSeats(event) > 0;
  });
}

function compareText(left, right) {
  const normalizedLeft = String(left).toLocaleLowerCase();
  const normalizedRight = String(right).toLocaleLowerCase();
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (String(left) < String(right)) return -1;
  if (String(left) > String(right)) return 1;
  return 0;
}

function cheapestPrice(event) {
  const prices = getTierPrices(event);
  return prices.length === 0 ? undefined : Math.min(...prices);
}

function compareByTitleThenId(left, right) {
  return compareText(left.title, right.title) || compareText(left.id, right.id);
}

export function sortEvents(summaries, sortBy) {
  if (!Array.isArray(summaries)) {
    validation('Event summaries must be an array.');
  }
  if (!['date', 'price', 'availability'].includes(sortBy)) {
    validation(`Unknown event sort option "${sortBy}".`);
  }

  return mergeSort(summaries, (left, right) => {
    let comparison = 0;
    if (sortBy === 'date') {
      comparison = parseIsoDate(left.date, 'Event date') - parseIsoDate(right.date, 'Event date');
    } else if (sortBy === 'price') {
      const leftPrice = cheapestPrice(left);
      const rightPrice = cheapestPrice(right);
      if (leftPrice === undefined && rightPrice !== undefined) return 1;
      if (rightPrice === undefined && leftPrice !== undefined) return -1;
      comparison = (leftPrice ?? 0) - (rightPrice ?? 0);
    } else {
      comparison = availableSeats(right) - availableSeats(left);
    }

    return comparison || compareByTitleThenId(left, right);
  });
}

export function searchEvents(summaries, criteria, sortBy) {
  return sortEvents(filterEvents(summaries, criteria), sortBy);
}
