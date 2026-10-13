import { createTwoFilesPatch } from 'diff';
import pc from 'picocolors';

export function formatUnifiedDiff(diff: string): string {
  const lines = diff.split('\n');
  return lines
    .map((line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return pc.green(line);
      }
      if (line.startsWith('-') && !line.startsWith('---')) {
        return pc.red(line);
      }
      if (line.startsWith('@@')) {
        return pc.cyan(line);
      }
      return pc.dim(line);
    })
    .join('\n');
}

export function generateDiff(filePath: string, oldContent: string, newContent: string): string {
  return createTwoFilesPatch(filePath, filePath, oldContent, newContent, 'current', 'incoming');
}
