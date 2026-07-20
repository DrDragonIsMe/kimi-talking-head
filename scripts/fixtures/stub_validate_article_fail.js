#!/usr/bin/env node
// 测试用口播稿预检 stub：模拟 scripts/validate_article.js 的硬约定
// （退出码 1=不通过，stdout 输出 JSON {ok, checks}），始终不通过。
process.stdout.write(
  JSON.stringify({
    ok: false,
    checks: [{ name: 'length', ok: false, detail: '有效字符数过少（stub）' }],
  })
);
process.exit(1);
