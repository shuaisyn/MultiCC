// Central event bus — decouples cross-domain calls so modules don't have to
// require() each other, which is how we break the dependency cycles that block
// splitting server.js (chat ⇄ triggers, chat ⇄ gateway, ...).
//
// Node's EventEmitter invokes listeners SYNCHRONOUSLY in registration order and
// propagates a listener's throw back to the emit() caller, so converting a
// direct fire-and-forget call into emit()/on() is behavior-preserving.
//
// Convention: event names are 'domain:verb' (e.g. 'chat:run',
// 'chat:turn-complete'). Emitters never depend on who listens; listeners are
// registered by the domain that owns the handler.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
// Many domains will eventually attach; lift the default 10-listener warning cap.
bus.setMaxListeners(50);

module.exports = bus;
