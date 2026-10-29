import { DomainError } from '../domain/errors.js';
import {
  addTier as addDomainTier,
  createEvent as createDomainEvent,
  createStore,
  listEventSummaries,
  publishEvent as publishDomainEvent,
  unpublishEvent as unpublishDomainEvent,
} from '../domain/inventory.js';
import { searchEvents } from '../domain/eventSearch.js';

function requireUserId(userId) {
  if (typeof userId !== 'string' || userId.trim() === '') {
    throw new DomainError('UNAUTHENTICATED', 'The x-user-id header is required.');
  }
  return userId.trim();
}

function storeWithEvent(event) {
  const store = createStore();
  store.events.set(event.id, event);
  return store;
}

function serializeTier(tier) {
  return {
    id: tier.id,
    name: tier.name,
    priceCents: tier.priceCents,
    capacity: tier.capacity,
    sold: tier.sold,
    seatsLeft: tier.seatsLeft,
  };
}

function serializeEvent(event) {
  return {
    id: event.id,
    title: event.title,
    city: event.city,
    venue: event.venue,
    date: event.date,
    published: event.published,
    tiers: [...event.tiers.values()].map(serializeTier),
  };
}

export function createEventService(repository) {
  return {
    async create(userId, details) {
      const store = createStore();
      const event = createDomainEvent(store, details);
      event.organizerId = requireUserId(userId);
      await repository.saveEvent(event);
      return serializeEvent(event);
    },

    async addTier(userId, eventId, details) {
      const event = await repository.findEvent(eventId);
      if (!event) {
        throw new DomainError('NOT_FOUND', `Event "${eventId}" was not found.`);
      }
      if (event.organizerId !== requireUserId(userId)) {
        throw new DomainError('FORBIDDEN', 'Only the event organizer can change its ticket tiers.');
      }
      const tier = addDomainTier(storeWithEvent(event), eventId, details);
      await repository.saveTier(eventId, tier);
      return serializeTier(tier);
    },

    async publish(userId, eventId) {
      const event = await repository.findEvent(eventId);
      if (!event) {
        throw new DomainError('NOT_FOUND', `Event "${eventId}" was not found.`);
      }
      if (event.organizerId !== requireUserId(userId)) {
        throw new DomainError('FORBIDDEN', 'Only the event organizer can publish this event.');
      }
      return serializeEvent(publishDomainEvent(storeWithEvent(event), eventId));
    },

    async unpublish(userId, eventId) {
      const event = await repository.findEvent(eventId);
      if (!event) {
        throw new DomainError('NOT_FOUND', `Event "${eventId}" was not found.`);
      }
      if (event.organizerId !== requireUserId(userId)) {
        throw new DomainError('FORBIDDEN', 'Only the event organizer can unpublish this event.');
      }
      return serializeEvent(unpublishDomainEvent(storeWithEvent(event), eventId));
    },

    async search(criteria, sortBy = 'date') {
      const events = await repository.listEvents();
      const store = createStore();
      for (const event of events) store.events.set(event.id, event);
      return searchEvents(listEventSummaries(store), criteria, sortBy);
    },
  };
}
