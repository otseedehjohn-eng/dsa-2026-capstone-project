import { cancelBooking, listMyBookings } from '../api.js';
import { getToken } from '../session.js';
import { el, formatPrice, getErrorMessage } from '../ui.js';

const status = document.querySelector('#tickets-status');
const list = document.querySelector('#tickets-list');

function bookingCard(booking) {
  const card = el('article', { className: 'ticket-card' }, [
    el('div', { className: 'ticket-card-heading' }, [
      el('div', {}, [
        el('p', { className: 'eyebrow' }, booking.eventTitle ?? 'Event booking'),
        el('h2', { className: 'ticket-reference' }, booking.reference),
      ]),
      el('span', { className: `booking-status status-${booking.status}` }, booking.status.replace('_', ' ')),
    ]),
    el('p', { className: 'ticket-detail' }, `Ticket tier: ${booking.tierName ?? booking.tierId}`),
    el('p', { className: 'ticket-detail' }, `Quantity: ${booking.quantity}`),
    el('div', { className: 'checkout-total' }, [
      el('span', {}, 'Total'),
      el('strong', {}, formatPrice(booking.totalCents)),
    ]),
  ]);

  if (booking.status === 'pending') {
    const cancelButton = el('button', { className: 'button button-outline', type: 'button' }, 'Cancel unpaid booking');
    const error = el('p', { className: 'form-error', role: 'alert', hidden: true });
    cancelButton.addEventListener('click', async () => {
      cancelButton.disabled = true;
      error.hidden = true;
      try {
        await cancelBooking(booking.reference);
        await loadBookings();
      } catch (requestError) {
        error.textContent = getErrorMessage(requestError);
        error.hidden = false;
        cancelButton.disabled = false;
      }
    });
    card.append(cancelButton, error);
  }
  return card;
}

async function loadBookings() {
  status.textContent = 'Loading your tickets…';
  list.replaceChildren();
  try {
    const bookings = await listMyBookings();
    if (bookings.length === 0) {
      status.textContent = 'No bookings yet. Find an event to get started.';
      return;
    }
    list.replaceChildren(...bookings.map(bookingCard));
    status.textContent = `${bookings.length} ${bookings.length === 1 ? 'booking' : 'bookings'}`;
  } catch (error) {
    status.textContent = getErrorMessage(error);
  }
}

if (!getToken()) {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
} else {
  loadBookings();
}
