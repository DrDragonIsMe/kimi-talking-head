#!/usr/bin/env node
// 测试用口播稿预检 stub：模拟 scripts/validate_article.js 的硬约定
// （退出码 0=通过，stdout 输出 JSON {ok, checks}），始终通过。
process.stdout.write(
  JSON.stringify({ ok: true, checks: [{ name: 'stub', ok: true, detail: 'stub pass' }] })
);
process.exit(0);
