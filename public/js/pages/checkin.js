import { checkIn } from '../api.js';
import { getCurrentUser, getToken } from '../session.js';
import { el, getErrorMessage } from '../ui.js';

const form = document.querySelector('#checkin-form');
const status = document.querySelector('#checkin-status');
const submitButton = form.querySelector('button[type="submit"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  submitButton.disabled = true;
  submitButton.textContent = 'Checking ticket…';
  status.classList.remove('status-error');
  status.textContent = 'Verifying ticket code…';
  try {
    const result = await checkIn(
      form.elements.ticketToken.value.trim(),
      form.elements.eventId.value.trim(),
    );
    status.replaceChildren(
      el('strong', {}, 'Admitted. '),
      `Ticket ${result.reference} checked in at ${new Date(result.checkedInAt).toLocaleString()}.`,
    );
    form.elements.ticketToken.value = '';
  } catch (error) {
    status.textContent = getErrorMessage(error);
    status.classList.add('status-error');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Check in';
  }
});

const user = getCurrentUser();
if (!getToken()) {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login.html?returnTo=${encodeURIComponent(returnTo)}`);
} else if (user?.role !== 'staff') {
  form.hidden = true;
  status.textContent = 'This page is for staff accounts.';
  status.classList.add('status-error');
}
