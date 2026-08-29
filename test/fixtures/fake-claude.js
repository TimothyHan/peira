#!/usr/bin/env node
// Stand-in for the `claude` CLI in tests (PEIRA_CLAUDE_BIN points here).
// Reads the prompt from stdin like the real headless mode, then:
//   FAKE_CLAUDE_EXIT=<n>    exit nonzero with stderr noise
//   FAKE_CLAUDE_ECHO=1      echo the prompt back (transport plumbing tests)
//   FAKE_CLAUDE_OUTPUT=...  print exactly this
//   default                 print one valid single-case compile response

let prompt = '';
process.stdin.on('data', (d) => (prompt += d));
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_EXIT) {
    process.stderr.write('fake-claude: simulated failure');
    process.exit(Number(process.env.FAKE_CLAUDE_EXIT));
  }
  if (process.env.FAKE_CLAUDE_ECHO === '1') {
    process.stdout.write(prompt);
    return;
  }
  if (process.env.FAKE_CLAUDE_OUTPUT !== undefined) {
    process.stdout.write(process.env.FAKE_CLAUDE_OUTPUT);
    return;
  }
  process.stdout.write(JSON.stringify({
    cases: [{
      id: 'CASE-fake-001',
      title: 'fake compiled case',
      test: { request: { method: 'get', route: '/thing' }, expect: { status: 200, body: { ok: true } } },
    }],
  }));
});
