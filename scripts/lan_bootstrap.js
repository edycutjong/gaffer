#!/usr/bin/env node
// Fully-offline LAN demo helper — runs a self-contained mini-DHT (a bootstrap
// node + two helper nodes, all non-ephemeral and unfirewalled) so peers on the
// same network can discover each other with the internet physically off.
//
// One bootstrapper alone is NOT enough: Hyperswarm's NAT detection needs a
// few DHT nodes to confirm reachability before a peer announces itself
// (that's also why hyperdht's own createTestnet spins up 3 nodes).
//
//   machine A:  node scripts/lan_bootstrap.js            (prints the flag)
//   machine A:  node cli.js --provider --bootstrap '[{"host":"<A-ip>","port":49737}]'
//   machine B:  node cli.js --client   --bootstrap '[{"host":"<A-ip>","port":49737}]'

import DHT from 'hyperdht'
import os from 'node:os'

const port = Number(process.argv[2] || 49737)

const bootstrapper = new DHT({ port, host: '0.0.0.0', ephemeral: false, firewalled: false, bootstrap: [] })
await bootstrapper.ready()

const nics = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal)
const lanHost = nics[0]?.address || '127.0.0.1'
const bootstrap = [{ host: lanHost, port: bootstrapper.address().port }]

// helper nodes give the DHT enough of a routing table for announces/lookups
const helpers = []
for (let i = 0; i < 2; i++) {
  const node = new DHT({ ephemeral: false, firewalled: false, bootstrap })
  await node.ready()
  helpers.push(node)
}

console.log('GAFFER LAN bootstrap running (self-contained 3-node DHT, no internet needed).')
console.log(`bootstrapper on udp ${bootstrapper.address().port} + ${helpers.length} helper nodes\n`)
console.log('pass ONE of these to both peers:')
for (const host of ['127.0.0.1', ...nics.map(i => i.address)]) {
  console.log(`  --bootstrap '[{"host":"${host}","port":${bootstrapper.address().port}}]'`)
}
console.log('\nCtrl-C to stop.')

const stop = async () => {
  for (const h of helpers) await h.destroy().catch(() => {})
  await bootstrapper.destroy().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
