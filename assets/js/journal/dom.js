export const app = document.querySelector('#habit-journal-app');

export function $(selector, root = app) {
  return root.querySelector(selector);
}

export function $all(selector, root = app) {
  return [...root.querySelectorAll(selector)];
}
