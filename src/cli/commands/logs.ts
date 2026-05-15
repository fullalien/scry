import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import type { AppConfig } from '../config/schema.js';

function tailLines(content: string, count: number): string[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - count));
}

export function registerLogsCommand(program: Command, config: AppConfig) {
  program
    .command('logs')
    .description('Show recent scrcpy-web logs')
    .option('--session <id>', 'Filter by session id')
    .option('--lines <n>', 'Number of lines', '100')
    .action(options => {
      const targetFile = config.logs.file;
      const lineCount = Math.max(1, Number(options.lines));
      const session = options.session as string | undefined;

      if (!existsSync(targetFile)) {
        console.log('No logs found.');
        return;
      }

      const content = readFileSync(targetFile, 'utf8');
      let lines = tailLines(content, lineCount);

      if (session) {
        lines = lines.filter(line =>
          line.includes(`\"session\":\"${session}\"`)
        );
      }

      if (lines.length === 0) {
        console.log('No matching logs.');
        return;
      }

      for (const line of lines) {
        console.log(line);
      }
    });
}
