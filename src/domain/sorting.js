import { DomainError } from './errors.js';

export function mergeSort(items, compare) {
  if (!Array.isArray(items)) {
    throw new DomainError('VALIDATION', 'Items must be an array.');
  }
  if (typeof compare !== 'function') {
    throw new DomainError('VALIDATION', 'A comparison function is required.');
  }

  if (items.length < 2) {
    return [...items];
  }

  const middle = Math.floor(items.length / 2);
  const left = mergeSort(items.slice(0, middle), compare);
  const right = mergeSort(items.slice(middle), compare);
  const result = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (compare(left[leftIndex], right[rightIndex]) <= 0) {
      result.push(left[leftIndex]);
      leftIndex += 1;
    } else {
      result.push(right[rightIndex]);
      rightIndex += 1;
    }
  }

  return result.concat(left.slice(leftIndex), right.slice(rightIndex));
}
