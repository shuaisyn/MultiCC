// Service registry — the request/response counterpart to the event bus.
//
// Use the BUS (src/bus.js) for fire-and-forget notifications: one-way, no
// return value, zero-or-many listeners.
// Use THIS REGISTRY when one domain must CALL another across a dependency
// cycle AND needs the return value back — e.g. gateway → chat's runChatTurn,
// whose boolean result signals launch success/failure.
//
// Both mechanisms exist only so a domain can reach another without a static
// require() of it, which is what would reintroduce the cycles we're removing.
// A domain registers its callables with provide(); callers invoke call().
const _services = new Map();

function provide(name, fn) {
  if (typeof fn !== 'function') throw new Error(`provide(${name}): not a function`);
  _services.set(name, fn);
}

function call(name, ...args) {
  const fn = _services.get(name);
  if (typeof fn !== 'function') throw new Error(`service not registered: ${name}`);
  return fn(...args);
}

function has(name) { return _services.has(name); }

module.exports = { provide, call, has };
