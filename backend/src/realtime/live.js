// Live updates for signed-in dashboards (/ws/live). The server only pushes:
// samples, node and group changes, alerts, events and log notices.
export function handleLive(core, ws) {
  core.liveSockets.add(ws);
  ws.on('close', () => core.liveSockets.delete(ws));
  ws.send(JSON.stringify({ type: 'hello', serverTime: core.now() }));
}
