import pc from 'picocolors';
import { runDoctorChecks, type DoctorOptions } from '../validators/prerequisites.js';
import { logger } from '../utils/logger.js';
import type { DoctorCheckItem } from '../validators/types.js';

export interface DoctorCommandOptions extends DoctorOptions {
  json?: boolean;
}

export async function doctorCommand(options: DoctorCommandOptions = {}): Promise<number> {
  const report = await runDoctorChecks(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.passed ? 0 : 1;
  }

  logger.raw('\n' + pc.bold(pc.cyan('=== react-native-release-kit Doctor ===')) + '\n');

  const categories: Array<{ id: DoctorCheckItem['category']; label: string }> = [
    { id: 'environment', label: 'System & Toolchain' },
    { id: 'config', label: 'Release Kit Configuration' },
    { id: 'android', label: 'Android Prerequisites' },
    { id: 'ios', label: 'iOS Prerequisites' },
  ];

  for (const cat of categories) {
    const items = report.checks.filter((c) => c.category === cat.id);
    if (items.length === 0) continue;

    logger.raw(pc.bold(pc.underline(cat.label)));
    for (const item of items) {
      if (item.status === 'pass') {
        logger.raw(`  ${pc.green('✔')} ${pc.bold(item.title)}: ${pc.dim(item.message)}`);
      } else if (item.status === 'warn') {
        logger.raw(`  ${pc.yellow('⚠')} ${pc.bold(item.title)}: ${item.message}`);
        if (item.remediation) {
          logger.raw(`    ${pc.dim('↳ Remedy: ' + item.remediation)}`);
        }
      } else {
        logger.raw(`  ${pc.red('✖')} ${pc.bold(item.title)}: ${item.message}`);
        if (item.remediation) {
          logger.raw(`    ${pc.cyan('↳ Remedy: ' + item.remediation)}`);
        }
      }
    }
    logger.raw('');
  }

  logger.raw(pc.bold('Summary:'));
  if (report.passed) {
    logger.raw(pc.green(`✔ All critical checks passed! (${report.warnings} warnings)\n`));
  } else {
    logger.raw(
      pc.red(
        `✖ Doctor found ${report.errors} critical issue(s) and ${report.warnings} warning(s).\n`,
      ),
    );
  }

  return report.passed ? 0 : 1;
}
