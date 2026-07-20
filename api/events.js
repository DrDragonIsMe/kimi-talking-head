// 轻量 SSE 广播：subscribe(res, user) 注册连接，publish(event) 向所有连接推送 JSON 帧。
// 单进程本地后台使用，客户端集合内存维护；25s 注释帧保活，连接关闭即移除。
// 鉴权开启时按连接的用户过滤：只投递 event.owner === user 的事件（user 为 null 时不过滤）。
const clients = new Set();

function subscribe(res, user = null) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  const client = { res, user };
  clients.add(client);
  res.on('close', () => clients.delete(client));
}

function publish(event) {
  const frame = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    // 鉴权模式下他人任务的事件不投递（与本路由的 404 隔离一致）
    if (client.user && event.owner !== client.user) continue;
    try {
      client.res.write(frame);
    } catch (_err) {
      clients.delete(client);
    }
  }
}

// 优雅停机时主动断开所有 SSE 连接，让 server.close() 能立即完成
function closeAll() {
  for (const client of clients) {
    try {
      client.res.end();
    } catch (_err) { /* 连接可能已断开 */ }
  }
  clients.clear();
}

// keep-alive 注释帧，防代理/浏览器空闲断连；unref 不阻塞进程退出。
// 间隔可经 SSE_KEEPALIVE_MS 覆盖（测试用短间隔验证保活帧，默认 25s）
const KEEPALIVE_MS = parseInt(process.env.SSE_KEEPALIVE_MS || '25000', 10);
setInterval(() => {
  for (const client of clients) {
    try {
      client.res.write(': ka\n\n');
    } catch (_err) {
      clients.delete(client);
    }
  }
}, KEEPALIVE_MS).unref();

module.exports = { subscribe, publish, closeAll };
