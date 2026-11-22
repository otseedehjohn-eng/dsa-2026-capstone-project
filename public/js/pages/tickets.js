import {
  acceptWaitlistOffer,
  cancelBooking,
  getCancellationPreview,
  listMyBookings,
  listMyWaitlistOffers,
} from '../api.js';
import { getToken } from '../session.js';
import { el, formatPrice, getErrorMessage } from '../ui.js';

const status = document.querySelector('#tickets-status');
const list = document.querySelector('#tickets-list');
const offersStatus = document.querySelector('#offers-status');
const offersList = document.querySelector('#waitlist-offers');
const offerTimers = new Set();

function clearOfferTimers() {
  for (const timer of offerTimers) window.clearInterval(timer);
  offerTimers.clear();
}

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

  if (booking.refundedCents > 0) {
    card.append(el('p', { className: 'ticket-detail' }, `Refunded: ${formatPrice(booking.refundedCents)}`));
  }

  if (booking.status === 'pending' || booking.status === 'paid') {
    const actions = el('div', { className: 'ticket-actions' });
    const cancelButton = el('button', { className: 'button button-outline', type: 'button' }, 'Cancel booking');
    const error = el('p', { className: 'form-error', role: 'alert', hidden: true });
    cancelButton.addEventListener('click', async () => {
      cancelButton.disabled = true;
      cancelButton.textContent = 'Checking refund…';
      error.hidden = true;
      try {
        const quote = await getCancellationPreview(booking.reference);
        const confirmation = el('div', { className: 'cancel-confirmation' }, [
          el('p', {}, `Refund if cancelled now: ${formatPrice(quote.refundCents)}`),
        ]);
        const confirmButton = el('button', {
          className: 'button button-dark',
          type: 'button',
        }, 'Confirm cancellation');
        const keepButton = el('button', {
          className: 'button button-outline',
          type: 'button',
        }, 'Keep booking');
        keepButton.addEventListener('click', () => {
          actions.replaceChildren(cancelButton, error);
          cancelButton.disabled = false;
          cancelButton.textContent = 'Cancel booking';
        });
        confirmButton.addEventListener('click', async () => {
          confirmButton.disabled = true;
          confirmButton.textContent = 'Cancelling…';
          error.hidden = true;
          try {
            const result = await cancelBooking(booking.reference);
            confirmation.replaceChildren(
              el('p', { className: 'success-message', role: 'status' },
                `Booking cancelled. Refund: ${formatPrice(result.refundedCents ?? 0)}.`),
            );
            actions.replaceChildren(confirmation);
            await loadBookings();
          } catch (requestError) {
            error.textContent = getErrorMessage(requestError);
            error.hidden = false;
            confirmButton.disabled = false;
            confirmButton.textContent = 'Confirm cancellation';
          }
        });
        confirmation.append(confirmButton, keepButton);
        actions.replaceChildren(confirmation, error);
      } catch (requestError) {
        error.textContent = getErrorMessage(requestError);
        error.hidden = false;
        cancelButton.disabled = false;
        cancelButton.textContent = 'Cancel booking';
      }
    });
    actions.append(cancelButton, error);
    card.append(actions);
  }
  return card;
}

function offerCard(offer) {
  const timer = el('p', { className: 'countdown', role: 'timer', 'aria-live': 'off' });
  const error = el('p', { className: 'form-error', role: 'alert', hidden: true });
  const acceptButton = el('button', { className: 'button button-green', type: 'button' }, 'Accept offer');
  const card = el('article', { className: 'ticket-card waitlist-offer-card' }, [
    el('div', { className: 'ticket-card-heading' }, [
      el('div', {}, [
        el('p', { className: 'eyebrow' }, offer.eventTitle),
        el('h3', { className: 'tier-name' }, offer.tierName),
      ]),
      el('span', { className: 'booking-status status-pending' }, 'Offer'),
    ]),
    el('p', { className: 'ticket-detail' }, `${offer.quantity} ticket${offer.quantity === 1 ? '' : 's'} held for you`),
    timer,
    acceptButton,
    error,
  ]);
  const expiresAt = Date.parse(offer.expiresAt);
  let expired = false;
  const updateTimer = () => {
    const remaining = Math.max(0, expiresAt - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    timer.textContent = remaining > 0
      ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} to accept`
      : 'Offer expired';
    if (remaining === 0 && !expired) {
      expired = true;
      acceptButton.disabled = true;
      window.clearInterval(timerId);
      loadBookings();
    }
  };
  const timerId = window.setInterval(updateTimer, 1000);
  offerTimers.add(timerId);
  updateTimer();

  acceptButton.addEventListener('click', async () => {
    acceptButton.disabled = true;
    acceptButton.textContent = 'Accepting…';
    error.hidden = true;
    try {
      await acceptWaitlistOffer(offer.id);
      await loadBookings();
    } catch (requestError) {
      error.textContent = getErrorMessage(requestError);
      error.hidden = false;
      if (requestError.code === 'OFFER_EXPIRED') {
        await loadBookings();
      } else {
        acceptButton.disabled = false;
        acceptButton.textContent = 'Accept offer';
      }
    }
  });
  return card;
}

async function loadBookings() {
  clearOfferTimers();
  status.textContent = 'Loading your tickets…';
  offersStatus.textContent = 'Checking for offers…';
  list.replaceChildren();
  offersList.replaceChildren();
  try {
    const [bookings, offers] = await Promise.all([
      listMyBookings(),
      listMyWaitlistOffers(),
    ]);
    if (bookings.length === 0) {
      status.textContent = 'No bookings yet. Find an event to get started.';
    } else {
      list.replaceChildren(...bookings.map(bookingCard));
      status.textContent = `${bookings.length} ${bookings.length === 1 ? 'booking' : 'bookings'}`;
    }
    if (offers.length === 0) {
      offersStatus.textContent = 'No active offers.';
    } else {
      offersList.replaceChildren(...offers.map(offerCard));
      offersStatus.textContent = `${offers.length} active ${offers.length === 1 ? 'offer' : 'offers'}`;
    }
  } catch (error) {
    status.textContent = getErrorMessage(error);
    offersStatus.textContent = getErrorMessage(error);
  }
}

window.addEventListener('pagehide', clearOfferTimers);

if (!getToken()) {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
} else {
  loadBookings();
}
