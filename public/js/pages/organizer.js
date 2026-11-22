import {
  addTier,
  createEvent,
  listOrganizerEvents,
  publishEvent,
  unpublishEvent,
} from '../api.js';
import { getCurrentUser, getToken } from '../session.js';
import { el, formatEventDate, formatPrice, getErrorMessage } from '../ui.js';

const createForm = document.querySelector('#create-event-form');
const createStatus = document.querySelector('#create-event-status');
const eventsStatus = document.querySelector('#events-status');
const eventsList = document.querySelector('#managed-events');

function showStatus(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle('status-error', isError);
}

function tierForm(event) {
  const form = el('form', { className: 'tier-create-form' });
  const nameId = `tier-name-${event.id}`;
  const priceId = `tier-price-${event.id}`;
  const capacityId = `tier-capacity-${event.id}`;
  const status = el('p', { className: 'form-status', role: 'status', 'aria-live': 'polite' });
  const submitButton = el('button', { className: 'button button-green', type: 'submit' }, 'Add tier');

  form.append(
    el('div', { className: 'dashboard-fields tier-create-fields' }, [
      el('div', { className: 'field' }, [
        el('label', { htmlFor: nameId }, 'Tier name'),
        el('input', { id: nameId, name: 'name', type: 'text', required: true }),
      ]),
      el('div', { className: 'field' }, [
        el('label', { htmlFor: priceId }, 'Price (whole cents)'),
        el('input', { id: priceId, name: 'priceCents', type: 'number', min: 0, step: 1, required: true }),
      ]),
      el('div', { className: 'field' }, [
        el('label', { htmlFor: capacityId }, 'Capacity'),
        el('input', { id: capacityId, name: 'capacity', type: 'number', min: 1, step: 1, required: true }),
      ]),
    ]),
    submitButton,
    status,
  );
  form.addEventListener('submit', async (submission) => {
    submission.preventDefault();
    const values = new FormData(form);
    const priceCents = Number(values.get('priceCents'));
    const capacity = Number(values.get('capacity'));
    if (!Number.isSafeInteger(priceCents) || !Number.isSafeInteger(capacity)) {
      showStatus(status, 'Price and capacity must be whole numbers.', true);
      return;
    }

    submitButton.disabled = true;
    showStatus(status, 'Adding ticket tier…');
    try {
      await addTier(event.id, {
        name: values.get('name'),
        priceCents,
        capacity,
      });
      form.reset();
      await loadEvents();
    } catch (error) {
      showStatus(status, getErrorMessage(error), true);
      submitButton.disabled = false;
    }
  });
  return form;
}

function managedEventCard(event) {
  const tiers = event.tiers.length > 0
    ? event.tiers.map((tier) => el('li', {}, `${tier.name} · ${formatPrice(tier.priceCents)} · ${tier.seatsLeft} left`))
    : [el('li', { className: 'empty-tier' }, 'No ticket tiers yet')];
  const card = el('article', { className: 'managed-event-card' }, [
    el('div', { className: 'managed-event-heading' }, [
      el('div', {}, [
        el('p', { className: 'eyebrow' }, `${event.city} · ${formatEventDate(event.date)}`),
        el('h3', { className: 'tier-name' }, event.title),
        el('p', { className: 'event-venue' }, event.venue),
      ]),
      el('span', {
        className: event.published ? 'booking-status status-paid' : 'booking-status status-pending',
      }, event.published ? 'Published' : 'Draft'),
    ]),
    el('ul', { className: 'managed-tier-list' }, tiers),
  ]);
  const eventActions = el('div', { className: 'event-actions' });

  if (event.published) {
    const unpublishButton = el('button', { className: 'button button-outline', type: 'button' }, 'Unpublish event');
    unpublishButton.addEventListener('click', async () => {
      unpublishButton.disabled = true;
      try {
        await unpublishEvent(event.id);
        await loadEvents();
      } catch (error) {
        showStatus(eventsStatus, getErrorMessage(error), true);
        unpublishButton.disabled = false;
      }
    });
    eventActions.append(unpublishButton);
  } else {
    const publishButton = el('button', {
      className: 'button button-dark',
      type: 'button',
      disabled: event.tiers.length === 0,
    }, 'Publish event');
    publishButton.addEventListener('click', async () => {
      publishButton.disabled = true;
      try {
        await publishEvent(event.id);
        await loadEvents();
      } catch (error) {
        showStatus(eventsStatus, getErrorMessage(error), true);
        publishButton.disabled = false;
      }
    });
    eventActions.append(publishButton);
  }

  card.append(eventActions);
  if (!event.published) card.append(tierForm(event));
  return card;
}

async function loadEvents() {
  showStatus(eventsStatus, 'Loading your events…');
  eventsList.replaceChildren();
  try {
    const events = await listOrganizerEvents();
    if (events.length === 0) {
      showStatus(eventsStatus, 'You have not created any events yet.');
      return;
    }
    eventsList.replaceChildren(...events.map(managedEventCard));
    showStatus(eventsStatus, `${events.length} ${events.length === 1 ? 'event' : 'events'}`);
  } catch (error) {
    showStatus(eventsStatus, getErrorMessage(error), true);
  }
}

createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = new FormData(createForm);
  const button = createForm.querySelector('button[type="submit"]');
  button.disabled = true;
  showStatus(createStatus, 'Creating event…');
  try {
    const date = new Date(values.get('date'));
    if (Number.isNaN(date.getTime())) throw new Error('Choose a valid event date and time.');
    await createEvent({
      title: values.get('title'),
      city: values.get('city'),
      venue: values.get('venue'),
      date: date.toISOString(),
    });
    createForm.reset();
    showStatus(createStatus, 'Draft event created.');
    await loadEvents();
  } catch (error) {
    showStatus(createStatus, getErrorMessage(error), true);
  } finally {
    button.disabled = false;
  }
});

const user = getCurrentUser();
if (!getToken()) {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
} else if (user?.role !== 'organizer') {
  showStatus(eventsStatus, 'This page is for organizer accounts.', true);
  createForm.hidden = true;
} else {
  loadEvents();
}
