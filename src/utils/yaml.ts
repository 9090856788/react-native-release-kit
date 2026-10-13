import yaml from 'js-yaml';

export interface YamlValidationResult {
  valid: boolean;
  errors: string[];
  parsed?: Record<string, unknown>;
}

export function validateWorkflowYaml(yamlContent: string): YamlValidationResult {
  const errors: string[] = [];

  if (!yamlContent || typeof yamlContent !== 'string' || yamlContent.trim().length === 0) {
    return {
      valid: false,
      errors: ['YAML content is empty'],
    };
  }

  // 1. Check for unclosed or mismatched GitHub expression braces
  const openExpressionCount = (yamlContent.match(/\$\{\{/g) || []).length;
  const closeExpressionCount = (yamlContent.match(/\}\}/g) || []).length;
  if (openExpressionCount !== closeExpressionCount) {
    errors.push(
      `Mismatched GitHub Actions expression braces: found ${openExpressionCount} '\${{' and ${closeExpressionCount} '}}'`,
    );
  }

  // 2. Parse YAML
  let parsed: unknown;
  try {
    parsed = yaml.load(yamlContent);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`YAML syntax error: ${msg}`);
    return {
      valid: false,
      errors,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    errors.push('Workflow YAML must parse to a root object/mapping');
    return {
      valid: false,
      errors,
    };
  }

  const doc = parsed as Record<string, unknown>;

  // 3. Validate root properties
  if (typeof doc['name'] !== 'string' || doc['name'].trim().length === 0) {
    errors.push('Workflow missing required root "name" property');
  }

  if (!doc['on']) {
    errors.push('Workflow missing required root "on" trigger property');
  }

  if (!doc['jobs'] || typeof doc['jobs'] !== 'object' || Array.isArray(doc['jobs'])) {
    errors.push('Workflow missing required "jobs" object mapping');
    return {
      valid: false,
      errors,
      parsed: doc,
    };
  }

  const jobs = doc['jobs'] as Record<string, unknown>;
  const jobKeys = Object.keys(jobs);
  if (jobKeys.length === 0) {
    errors.push('Workflow must contain at least one job in "jobs"');
  }

  // 4. Validate each job
  for (const jobKey of jobKeys) {
    const job = jobs[jobKey];
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
      errors.push(`Job "${jobKey}" must be an object`);
      continue;
    }

    const jobObj = job as Record<string, unknown>;

    // Job must have runs-on (or uses for reusable workflows)
    if (!jobObj['runs-on'] && !jobObj['uses']) {
      errors.push(`Job "${jobKey}" must specify "runs-on" or "uses"`);
    }

    // If it's a standard job, it must have steps
    if (!jobObj['uses']) {
      if (!Array.isArray(jobObj['steps']) || jobObj['steps'].length === 0) {
        errors.push(`Job "${jobKey}" must specify a non-empty array of "steps"`);
      } else {
        const steps = jobObj['steps'] as unknown[];
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (!step || typeof step !== 'object') {
            errors.push(`Job "${jobKey}" step #${i + 1} must be an object`);
            continue;
          }
          const stepObj = step as Record<string, unknown>;
          if (!stepObj['uses'] && !stepObj['run']) {
            errors.push(
              `Job "${jobKey}" step #${i + 1} (${String(stepObj['name'] || 'unnamed')}) must have either "uses" or "run"`,
            );
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed: doc,
  };
}

