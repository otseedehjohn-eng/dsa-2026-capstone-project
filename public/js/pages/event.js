import {
  cancelBooking,
  createBooking,
  getEvent,
  joinWaitlist,
  pay,
} from '../api.js';
import {
  el,
  formatEventDate,
  formatPrice,
  getErrorMessage,
} from '../ui.js';
import { getToken } from '../session.js';

const content = document.querySelector('#event-content');
let countdownTimer;

function clearCountdown() {
  if (countdownTimer !== undefined) {
    window.clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
}

function eventIntro(event) {
  return el('section', { className: 'event-intro' }, [
    el('p', { className: 'eyebrow' }, `${event.city} · ${formatEventDate(event.date, {
      hour: 'numeric',
      minute: '2-digit',
    })}`),
    el('h1', { className: 'event-page-title' }, event.title),
    el('p', { className: 'event-venue event-page-venue' }, event.venue),
  ]);
}

function checkoutPanel(booking) {
  const panel = el('section', { className: 'checkout-panel', 'aria-labelledby': 'checkout-title' });
  const timer = el('p', { className: 'countdown', role: 'timer', 'aria-live': 'off' });
  const payForm = el('form', { className: 'pay-form' });
  const paymentResultId = `payment-result-${booking.reference}`;
  const errorMessage = el('p', { className: 'form-error', role: 'alert', hidden: true });

  panel.append(
    el('div', { className: 'checkout-heading' }, [
      el('div', {}, [
        el('p', { className: 'eyebrow' }, 'Your tickets are held'),
        el('h2', { id: 'checkout-title' }, 'Checkout'),
      ]),
      el('span', { className: 'booking-reference' }, booking.reference),
    ]),
    el('p', { className: 'checkout-summary' }, `${booking.quantity} ticket${booking.quantity === 1 ? '' : 's'} · ${booking.attendeeName}`),
    el('div', { className: 'checkout-total' }, [
      el('span', {}, 'Total'),
      el('strong', {}, formatPrice(booking.totalCents)),
    ]),
    el('div', { className: 'hold-notice' }, [
      el('span', { 'aria-hidden': 'true' }, '◷'),
      el('div', {}, [
        el('p', { className: 'hold-title' }, 'Complete payment before your hold ends'),
        timer,
      ]),
    ]),
  );

  const paymentResult = el('select', { id: paymentResultId, name: 'decline' }, [
    el('option', { value: 'false' }, 'Approved mock card'),
    el('option', { value: 'true' }, 'Declined mock card'),
  ]);
  payForm.append(
    el('label', { htmlFor: paymentResultId }, 'Mock card result'),
    paymentResult,
    el('button', { className: 'button button-dark pay-button', type: 'submit' }, `Pay ${formatPrice(booking.totalCents)}`),
    errorMessage,
  );
  const payButton = payForm.querySelector('button[type="submit"]');
  const payButtonText = payButton.textContent;

  payForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    payButton.disabled = true;
    payButton.textContent = 'Processing payment…';
    errorMessage.hidden = true;

    try {
      const paidBooking = await pay(booking.reference, {
        decline: paymentResult.value === 'true',
      });
      clearCountdown();
      payForm.replaceChildren(
        el('p', { className: 'success-message', role: 'status' }, `Payment confirmed. Your booking reference is ${paidBooking.reference}.`),
      );
      timer.textContent = 'Payment complete';
    } catch (error) {
      errorMessage.textContent = getErrorMessage(error);
      errorMessage.hidden = false;
      payButton.disabled = false;
      payButton.textContent = payButtonText;
    }
  });
  panel.append(payForm);

  const expiresAt = Date.parse(booking.holdExpiresAt);
  function updateCountdown() {
    const remaining = Math.max(0, expiresAt - Date.now());
    const totalSeconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    timer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} remaining`;

    if (remaining === 0) {
      clearCountdown();
      cancelBooking(booking.reference).catch((error) => {
        if (error.code !== 'BOOKING_EXPIRED') {
          errorMessage.textContent = getErrorMessage(error);
          errorMessage.hidden = false;
        }
      });
      timer.textContent = 'Hold expired';
      errorMessage.textContent = 'Your ticket hold expired. Return to the event to choose tickets again.';
      errorMessage.hidden = false;
      payForm.querySelector('button[type="submit"]').disabled = true;
    }
  }

  updateCountdown();
  if (expiresAt > Date.now()) {
    countdownTimer = window.setInterval(updateCountdown, 1000);
  }
  return panel;
}

function ticketTier(tier, eventId, onBooked) {
  const soldOut = tier.seatsLeft === 0;
  const quantityId = `quantity-${tier.id}`;
  const attendeeId = `attendee-${tier.id}`;
  const form = el('form', { className: 'ticket-form' });
  const errorMessage = el('p', { className: 'form-error', role: 'alert', hidden: true });
  const quantity = el('input', {
    id: quantityId,
    name: 'quantity',
    type: 'number',
    min: 1,
    max: Math.min(10, tier.seatsLeft),
    value: 1,
    step: 1,
    required: true,
    disabled: soldOut,
  });
  const attendeeName = el('input', {
    id: attendeeId,
    name: 'attendeeName',
    type: 'text',
    autocomplete: 'name',
    placeholder: 'Your name',
    required: true,
  });
  const submitButton = el('button', {
    className: soldOut ? 'button button-outline' : 'button button-green',
    type: 'submit',
  }, soldOut ? 'Join waitlist' : 'Continue to checkout');

  const fields = [
    el('div', { className: 'field' }, [
      el('label', { htmlFor: attendeeId }, 'Attendee name'),
      attendeeName,
    ]),
  ];
  if (!soldOut) {
    fields.push(el('div', { className: 'field quantity-field' }, [
      el('label', { htmlFor: quantityId }, `Quantity · up to ${Math.min(10, tier.seatsLeft)}`),
      quantity,
    ]));
  }

  form.append(
    el('div', { className: soldOut ? 'tier-fields waitlist-fields' : 'tier-fields' }, fields),
    submitButton,
    errorMessage,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    if (!getToken()) {
      const returnTo = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = soldOut ? 'Joining waitlist…' : 'Creating booking…';
    errorMessage.hidden = true;
    try {
      if (soldOut) {
        await joinWaitlist({
          eventId,
          tierId: tier.id,
          attendeeName: attendeeName.value,
        });
        submitButton.textContent = 'Joined waitlist';
        return;
      }
      const booking = await createBooking({
        eventId,
        tierId: tier.id,
        attendeeName: attendeeName.value,
        quantity: Number(quantity.value),
      });
      onBooked(booking);
    } catch (error) {
      if (soldOut && error.code === 'NOT_SOLD_OUT') {
        try {
          renderEvent(await getEvent(eventId));
          content.prepend(
            el('p', { className: 'form-status', role: 'status' },
              'Seats became available. Ticket availability has been refreshed.'),
          );
          return;
        } catch (refreshError) {
          errorMessage.textContent = getErrorMessage(refreshError);
          errorMessage.hidden = false;
          submitButton.disabled = false;
          submitButton.textContent = 'Join waitlist';
          return;
        }
      }
      errorMessage.textContent = getErrorMessage(error);
      errorMessage.hidden = false;
      submitButton.disabled = false;
      submitButton.textContent = soldOut ? 'Join waitlist' : 'Continue to checkout';
    }
  });

  return el('article', { className: `tier-card${soldOut ? ' tier-sold-out' : ''}` }, [
    el('div', { className: 'tier-heading' }, [
      el('div', {}, [
        el('h3', { className: 'tier-name' }, tier.name),
        el('p', { className: 'tier-availability' }, soldOut ? 'Sold out' : `${tier.seatsLeft} available`),
      ]),
      el('p', { className: 'tier-price' }, formatPrice(tier.priceCents)),
    ]),
    form,
  ]);
}

function renderEvent(event, booking) {
  clearCountdown();
  const tierCards = event.tiers.map((tier) => ticketTier(tier, event.id, async (newBooking) => {
    try {
      const updatedEvent = await getEvent(event.id);
      renderEvent(updatedEvent, newBooking);
    } catch (error) {
      renderEvent(event, newBooking);
      content.prepend(
        el('p', { className: 'error-panel', role: 'alert' },
          `Your booking was created, but availability could not refresh: ${getErrorMessage(error)}`),
      );
    }
  }));
  const ticketSection = el('section', { className: 'tickets-section', 'aria-labelledby': 'tickets-title' }, [
    el('div', { className: 'section-heading' }, [
      el('div', {}, [
        el('p', { className: 'eyebrow' }, 'Choose your experience'),
        el('h2', { id: 'tickets-title' }, 'Tickets'),
      ]),
    ]),
    el('div', { className: 'tier-list' }, tierCards),
  ]);

  content.replaceChildren(
    eventIntro(event),
    booking ? checkoutPanel(booking) : null,
    ticketSection,
  );
}

async function loadEvent() {
  const eventId = new URLSearchParams(window.location.search).get('id');
  if (!eventId) {
    content.replaceChildren(
      el('p', { className: 'error-panel', role: 'alert' }, 'Choose an event from the browse page to see its tickets.'),
    );
    return;
  }

  try {
    const event = await getEvent(eventId);
    renderEvent(event);
  } catch (error) {
    content.replaceChildren(
      el('p', { className: 'error-panel', role: 'alert' }, getErrorMessage(error)),
    );
  }
}

window.addEventListener('pagehide', clearCountdown);
loadEvent();
