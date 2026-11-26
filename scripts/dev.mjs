import { spawn } from 'node:child_process';

const tasks = [
  ['CSS', 'npx tailwindcss -i src/app.css -o public/styles.css --watch'],
  ['SRV', 'npx tsx watch src/index.ts'],
];

const children = [];

for (const [tag, command] of tasks) {
  const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const pipe = (stream) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        if (line.trim()) process.stdout.write(`[${tag}] ${line}\n`);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);

  child.on('exit', (code) => {
    if (code !== 0) process.exitCode = code ?? 0;
  });

  children.push(child);
}

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
