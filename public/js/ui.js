function appendChild(parent, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const nestedChild of child) appendChild(parent, nestedChild);
    return;
  }
  if (child instanceof Node) {
    parent.append(child);
    return;
  }
  const text = document.createTextNode('');
  text.textContent = String(child);
  parent.append(text);
}

export function el(tag, props = {}, children = []) {
  const element = document.createElement(tag);

  for (const [name, value] of Object.entries(props ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name.startsWith('on') && typeof value === 'function') {
      element.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === 'className') {
      element.className = value;
    } else if (name === 'htmlFor') {
      element.htmlFor = value;
    } else if (name in element) {
      element[name] = value;
    } else {
      element.setAttribute(name, value === true ? '' : String(value));
    }
  }

  appendChild(element, children);
  return element;
}

export function formatPrice(priceCents) {
  if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
    throw new TypeError('Price must be a non-negative whole number of cents.');
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(priceCents / 100);
}

export function formatEventDate(value, options = {}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date to be announced';
  return new Intl.DateTimeFormat('en-NG', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...options,
  }).format(date);
}

export function getErrorMessage(error) {
  return error?.error?.message ?? error?.message ?? 'Something went wrong. Please try again.';
}
