'use strict';
// Directory-domain composition root. server.js supplies the port adapters
// (git/session/event/fs implementations bound to its runtime state); this
// factory wires repository → service → controller and hands back all three so
// the caller can mount the router and keep legacy access to the repo Map.
const { createFsDirectoryRepository } = require('./repository');
const { createDirectoryService } = require('./service');
const { createDirectoryRouter } = require('./controller');

function createDirectoryModule({ repository, git, sessions, events, fsPort, helpers }) {
  const repo = createFsDirectoryRepository({ ...repository, realPathOf: helpers.realPathOf });
  const service = createDirectoryService({ repo, git, sessions, events, fsPort, helpers });
  const router = createDirectoryRouter(service);
  return { repo, service, router };
}

module.exports = { createDirectoryModule };
